import { request as httpsRequest } from 'node:https'
import { lookup as systemLookup } from 'node:dns/promises'
import { Readable } from 'node:stream'
import { isIP } from 'node:net'
import { resolveDestination, privateCidrs } from './egress-policy.mjs'
import { managedServiceRoot } from '../../shared/contracts/source-access.ts'
import {
  validateConnectorMessage,
  CONNECTOR_BODY_LIMIT,
} from '../../server/adapters/source-connector.ts'
import { serviceEndpoint, RESPONSE_LIMIT } from '../../server/adapters/transport.ts'
import { hmacKey, verifyMac, unhex, tokenValid } from '../../server/services/auth-crypto.ts'

export async function pinnedHttpsRead(message, signal, options = {}) {
  const scope = message.source.access.mode
  const target = new URL(
    serviceEndpoint(managedServiceRoot(message.source.baseUrl, scope), message.endpoint),
  )
  const pinned = await resolveDestination(
    target.hostname,
    scope,
    options.lookup ?? systemLookup,
    options.privateRanges ?? [],
  )
  if (signal.aborted) throw new Error('ABORTED')
  return new Promise((resolve, reject) => {
    const req = (options.request ?? httpsRequest)(
      target,
      {
        method: 'GET',
        agent: false,
        autoSelectFamily: false,
        family: pinned.family,
        ...(isIP(target.hostname.replace(/^\[|\]$/g, '')) ? {} : { servername: target.hostname }),
        rejectUnauthorized: true,
        lookup: (_host, _options, done) => done(null, pinned.address, pinned.family),
        signal,
        maxHeaderSize: 16384,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          ...(message.source.access.authentication === 'bearer'
            ? { Authorization: 'Bearer ' + message.credential }
            : {}),
        },
      },
      (res) => {
        const headers = new Headers()
        for (const name of ['content-type', 'content-length', 'retry-after', 'age'])
          if (typeof res.headers[name] === 'string') headers.set(name, res.headers[name])
        const length = Number(res.headers['content-length'])
        if (length > RESPONSE_LIMIT) {
          res.destroy()
          reject(new Error('RESPONSE_TOO_LARGE'))
          return
        }
        resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers }))
      },
    )
    req.on('error', () => reject(new Error('UPSTREAM_UNAVAILABLE')))
    req.end()
  })
}
export function createSourceConnector(token, options = {}) {
  if (!tokenValid(token)) throw new Error('CONNECTOR_TOKEN_INVALID')
  const ranges = privateCidrs(options.privateCidrs ?? '')
  const key = hmacKey(token),
    seen = new Map()
  let active = 0
  const reject = (status, code) =>
    new Response(null, {
      status,
      headers: { 'X-Nozoki-Connector-Error': code, 'Cache-Control': 'no-store' },
    })
  return async (request) => {
    const url = new URL(request.url)
    if (
      request.method !== 'POST' ||
      url.pathname !== '/v1/read' ||
      url.search ||
      request.headers.has('origin')
    )
      return reject(403, 'CONNECTOR_UNAVAILABLE')
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 9000)
    let stopAbort
    const interrupted = new Promise((_, reject) => {
      stopAbort = () => reject(new Error('TIMEOUT'))
      controller.signal.addEventListener('abort', stopAbort, { once: true })
    })
    void interrupted.catch(() => {})
    const bounded = (promise) => Promise.race([promise, interrupted])
    const abort = () => controller.abort()
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) controller.abort()
    let reader,
      reserved = false
    try {
      const time = request.headers.get('X-Nozoki-Time') ?? '',
        nonce = request.headers.get('X-Nozoki-Nonce') ?? '',
        signature = request.headers.get('X-Nozoki-Signature') ?? ''
      if (
        !/^\d{13}$/.test(time) ||
        Math.abs(Date.now() - Number(time)) > 30000 ||
        !tokenValid(nonce) ||
        !/^[a-f0-9]{64}$/.test(signature)
      )
        return reject(403, 'CONNECTOR_UNAVAILABLE')
      if (!request.body || Number(request.headers.get('content-length')) > CONNECTOR_BODY_LIMIT)
        return reject(413, 'CONNECTOR_UNAVAILABLE')
      reader = request.body.getReader()
      const chunks = []
      let size = 0
      while (true) {
        const part = await bounded(reader.read())
        if (part.done) break
        size += part.value.length
        if (size > CONNECTOR_BODY_LIMIT) return reject(413, 'CONNECTOR_UNAVAILABLE')
        chunks.push(part.value)
      }
      const body = Buffer.concat(chunks).toString('utf8')
      if (
        !(await verifyMac(await key, ['nozoki-connector-v1', time, nonce, body], unhex(signature)))
      )
        return reject(403, 'CONNECTOR_UNAVAILABLE')
      for (const [n, expires] of seen) if (expires < Date.now()) seen.delete(n)
      if (seen.has(nonce) || seen.size >= 4096) return reject(429, 'RATE_LIMITED')
      seen.set(nonce, Date.now() + 60000)
      const message = validateConnectorMessage(JSON.parse(body))
      if (active >= 2) return reject(429, 'RATE_LIMITED')
      active++
      reserved = true
      const upstream = await bounded(
        pinnedHttpsRead(message, controller.signal, { ...options, privateRanges: ranges }),
      )
      // Buffer once inside the connector so timeout/size limits cover the full upstream body.
      const upstreamReader = upstream.body?.getReader(),
        parts = []
      let total = 0
      if (!upstreamReader) throw new Error('INVALID_RESPONSE')
      try {
        while (true) {
          const part = await bounded(upstreamReader.read())
          if (part.done) break
          total += part.value.length
          if (total > RESPONSE_LIMIT) throw new Error('RESPONSE_TOO_LARGE')
          parts.push(part.value)
        }
      } finally {
        void upstreamReader.cancel().catch(() => {})
        upstreamReader.releaseLock()
      }
      return new Response(Buffer.concat(parts), {
        status: upstream.status,
        headers: upstream.headers,
      })
    } catch (error) {
      return reject(
        502,
        error?.message === 'DESTINATION_BLOCKED' ? 'DESTINATION_BLOCKED' : 'CONNECTOR_UNAVAILABLE',
      )
    } finally {
      if (reserved) active--
      controller.abort()
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', stopAbort)
      if (reader) {
        void reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
  }
}
