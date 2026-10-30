import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { normalizeServiceTarget } from '../services/service-target.ts'
import { AdapterError, type ReadTransport } from './types.ts'
export const RESPONSE_LIMIT = 131072
export interface TransportOptions {
  signal?: AbortSignal
  timeoutMs?: number
  onRead?: (bytes: number) => void
  onRequest?: () => void
}
export function endpointCatalog(source: IntegrationSettings): readonly string[] {
  switch (source.provider) {
    case 'deepseek':
      return ['user/balance']
    case 'sleepy':
      return ['api/meta', 'api/status/query']
    case 'cliproxy-bridge':
      if (source.protocolVersion === 'cliproxy-v8-accounts') return ['v8/management/credentials']
      return ['v8/management/config/observability/usage/usage-statistics-enabled']
    case 'uptimeflare':
      return ['api/data']
    case 'uptime-kuma': {
      const slug = source.fieldMappings.status_page_slug
      if (!slug || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug))
        throw new AdapterError('NOT_CONFIGURED')
      return [`api/status-page/${slug}`, `api/status-page/heartbeat/${slug}`]
    }
    default:
      return []
  }
}
export function serviceEndpoint(base: string, endpoint: string): string {
  if (!/^https:\/\//i.test(base) || /[%\\\s]/.test(base))
    throw new AdapterError('TARGET_NOT_APPROVED')
  const rawPath = base.replace(/^https:\/\/[^/]+/i, '')
  if (
    rawPath.split('/').some((p) => p === '.' || p === '..') ||
    !/^(?:\/[A-Za-z0-9._~-]+)*\/?$/.test(rawPath)
  )
    throw new AdapterError('TARGET_NOT_APPROVED')
  let target: string
  try {
    target = normalizeServiceTarget(base)!
  } catch {
    throw new AdapterError('TARGET_NOT_APPROVED')
  }
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(endpoint))
    throw new AdapterError('TARGET_NOT_APPROVED')
  const resolved = new URL(endpoint, target),
    root = new URL(target)
  if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.pathname))
    throw new AdapterError('TARGET_NOT_APPROVED')
  return resolved.href
}
/** The only production direct destination. Custom DNS is never checked-then-fetched. */
export function assertProductionTarget(source: IntegrationSettings) {
  if (!source.baseUrl) throw new AdapterError('NOT_CONFIGURED')
  const sample = serviceEndpoint(source.baseUrl, 'probe')
  if (source.provider !== 'deepseek' || sample !== 'https://api.deepseek.com/probe')
    throw new AdapterError('TARGET_NOT_APPROVED')
}
function complexity(text: string) {
  let depth = 0,
    tokens = 0,
    quoted = false,
    escaped = false
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === '[' || c === '{') {
      if (++depth > 16) throw new AdapterError('INVALID_RESPONSE')
      tokens++
    } else if (c === ']' || c === '}') depth--
    else if (c === ',' || c === ':') tokens++
    if (tokens > 10000) throw new AdapterError('INVALID_RESPONSE')
  }
}
function retryDelay(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000)
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 31536000 ? seconds : undefined
}
/** Inject a trusted wire function, never user code. Used by offline fixtures / future reviewed egress. */
export function responseTransport(
  source: IntegrationSettings,
  wire: (endpoint: string, signal: AbortSignal) => Promise<Response>,
  options: TransportOptions = {},
): ReadTransport {
  return boundedReadTransport(endpointCatalog(source), wire, options)
}
export function boundedReadTransport(
  allowed: readonly string[],
  wire: (endpoint: string, signal: AbortSignal) => Promise<Response>,
  options: TransportOptions = {},
): ReadTransport {
  let requests = 0,
    active = false
  return {
    async get(endpoint) {
      if (!allowed.includes(endpoint)) throw new AdapterError('TARGET_NOT_APPROVED')
      if (++requests > 2 || active) throw new AdapterError('REQUEST_BUDGET')
      active = true
      const controller = new AbortController()
      let expired = false
      const abort = () => controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) controller.abort()
      const timer = setTimeout(() => {
        expired = true
        controller.abort()
      }, options.timeoutMs ?? 3500)
      let cancelWait: () => void = () => {}
      const interrupted = new Promise<never>((_, reject) => {
        const stop = () => reject(new AdapterError(expired ? 'TIMEOUT' : 'ABORTED'))
        controller.signal.addEventListener('abort', stop, { once: true })
        cancelWait = () => controller.signal.removeEventListener('abort', stop)
        if (controller.signal.aborted) stop()
      })
      let received = false
      let response: Response | undefined,
        reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        if (controller.signal.aborted) await interrupted
        response = await Promise.race([
          wire(endpoint, controller.signal).then((r) => {
            if (controller.signal.aborted) void r.body?.cancel().catch(() => {})
            return r
          }),
          interrupted,
        ])
        received = true
        if (response.status >= 300 && response.status < 400)
          throw new AdapterError('REDIRECT_REJECTED')
        if (response.status === 401 || response.status === 403)
          throw new AdapterError('AUTH_REQUIRED')
        if (response.status === 429)
          throw new AdapterError(
            'RATE_LIMITED',
            retryDelay(response.headers.get('retry-after'), Date.now()),
          )
        if (response.status === 404) throw new AdapterError('NOT_FOUND')
        if (!response.ok) throw new AdapterError('UPSTREAM_UNAVAILABLE')
        if (
          !/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(
            response.headers.get('content-type') ?? '',
          )
        )
          throw new AdapterError('INVALID_RESPONSE')
        const length = response.headers.get('content-length')
        if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT))
          throw new AdapterError('RESPONSE_TOO_LARGE')
        reader = response.body?.getReader()
        if (!reader) throw new AdapterError('INVALID_RESPONSE')
        const parts: Uint8Array[] = []
        let size = 0
        while (true) {
          const part = await Promise.race([reader.read(), interrupted])
          if (part.done) break
          size += part.value.byteLength
          options.onRead?.(part.value.byteLength)
          if (size > RESPONSE_LIMIT) throw new AdapterError('RESPONSE_TOO_LARGE')
          parts.push(part.value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const p of parts) {
          bytes.set(p, offset)
          offset += p.length
        }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        complexity(text)
        const age = response.headers.get('age')
        return {
          value: JSON.parse(text) as unknown,
          ageSeconds: age && /^\d+$/.test(age) ? Number(age) : null,
        }
      } catch (error) {
        if (error instanceof AdapterError) throw error
        throw new AdapterError(
          controller.signal.aborted
            ? expired
              ? 'TIMEOUT'
              : 'ABORTED'
            : received
              ? 'INVALID_RESPONSE'
              : 'UPSTREAM_UNAVAILABLE',
        )
      } finally {
        clearTimeout(timer)
        cancelWait()
        options.signal?.removeEventListener('abort', abort)
        controller.abort()
        if (reader) {
          void reader.cancel().catch(() => {})
          reader.releaseLock()
        } else if (response) void response.body?.cancel().catch(() => {})
        active = false
      }
    },
  }
}
export function productionTransport(
  source: IntegrationSettings,
  credential: string | undefined,
  options: TransportOptions = {},
): ReadTransport {
  assertProductionTarget(source)
  if (!credential) throw new AdapterError('AUTH_REQUIRED')
  if (/[\r\n\u0000]/.test(credential)) throw new AdapterError('CREDENTIAL_INVALID')
  const base = source.baseUrl!
  return responseTransport(
    source,
    (endpoint, signal) => {
      options.onRequest?.()
      return fetch(serviceEndpoint(base, endpoint), {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + credential },
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal,
      })
    },
    options,
  )
}
