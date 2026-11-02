import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { normalizeServiceTarget } from '../services/service-target.ts'
import { AdapterError, type ReadTransport } from './types.ts'
import { publicTarget } from './public-targets.ts'
import { tailscaleTransport } from './tailscale-transport.ts'
import {
  yahooChartEndpoint,
  isYahooChartEndpoint,
  type QuoteSymbolInput,
} from '../../shared/quotes/yahoo-symbol.ts'
import { tencentChartEndpoint, isTencentChartEndpoint } from '../../shared/quotes/tencent-symbol.ts'
export const RESPONSE_LIMIT = 131072
export interface TransportOptions {
  quoteSymbols?: readonly QuoteSymbolInput[]
  environment?: Record<string, unknown>
  /** Trusted runtime injection for offline tests or a platform HTTP implementation. */
  fetch?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  onRead?: (bytes: number) => void
  onRequest?: () => void
}
export function endpointCatalog(
  source: IntegrationSettings,
  quoteSymbols: readonly QuoteSymbolInput[] = [],
): readonly string[] {
  switch (source.provider) {
    case 'tailscale':
      return ['api/v2/tailnet/-/devices']
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
    case 'quotes-custom': {
      if (!['yahoo-chart-v8', 'tencent-us-v1'].includes(source.protocolVersion)) return []
      if (quoteSymbols.length > 20) throw new AdapterError('REQUEST_BUDGET')
      try {
        return [
          ...new Set(
            quoteSymbols.map(
              source.protocolVersion === 'tencent-us-v1'
                ? tencentChartEndpoint
                : yahooChartEndpoint,
            ),
          ),
        ]
      } catch {
        throw new AdapterError('TARGET_NOT_APPROVED')
      }
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
  if (
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(endpoint) &&
    !isYahooChartEndpoint(endpoint) &&
    !isTencentChartEndpoint(endpoint)
  )
    throw new AdapterError('TARGET_NOT_APPROVED')
  const resolved = new URL(endpoint, target),
    root = new URL(target)
  if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.pathname))
    throw new AdapterError('TARGET_NOT_APPROVED')
  return resolved.href
}
/** Resolve a built-in service or an exact deployment-owned public route. */
export function assertProductionTarget(
  source: IntegrationSettings,
  env: Record<string, unknown> = {},
) {
  if (!source.baseUrl) throw new AdapterError('NOT_CONFIGURED')
  serviceEndpoint(source.baseUrl, 'probe')
  const target = publicTarget(source, env)
  if (!target) throw new AdapterError('TARGET_NOT_APPROVED')
  return target
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
  const allowed = endpointCatalog(source, options.quoteSymbols)
  return boundedReadTransport(
    allowed,
    wire,
    options,
    source.provider === 'quotes-custom' ? Math.min(20, allowed.length) : 2,
  )
}
export function boundedReadTransport(
  allowed: readonly string[],
  wire: (endpoint: string, signal: AbortSignal) => Promise<Response>,
  options: TransportOptions = {},
  requestLimit = 2,
): ReadTransport {
  let requests = 0,
    active = false
  return {
    async get(endpoint) {
      if (!allowed.includes(endpoint)) throw new AdapterError('TARGET_NOT_APPROVED')
      if (++requests > requestLimit || active) throw new AdapterError('REQUEST_BUDGET')
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
          ) &&
          !(
            isTencentChartEndpoint(endpoint) &&
            /^text\/html\s*;\s*charset=utf-8\s*$/i.test(response.headers.get('content-type') ?? '')
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
  if (!source.enabled) throw new AdapterError('SOURCE_DISABLED')
  const target = assertProductionTarget(source, options.environment)
  if (target.authentication === 'tailscale-oauth')
    return tailscaleTransport(source, credential, options)
  if (target.authentication === 'bearer' && !credential) throw new AdapterError('AUTH_REQUIRED')
  if (target.authentication === 'bearer' && /[\r\n\u0000]/.test(credential!))
    throw new AdapterError('CREDENTIAL_INVALID')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (target.authentication === 'bearer') headers.Authorization = 'Bearer ' + credential
  const wire = options.fetch ?? fetch
  return responseTransport(
    source,
    (endpoint, signal) => {
      options.onRequest?.()
      return wire(serviceEndpoint(target.baseUrl, endpoint), {
        method: 'GET',
        headers,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal,
      })
    },
    {
      ...options,
      timeoutMs: options.timeoutMs ?? (source.provider === 'quotes-custom' ? 10000 : 3500),
    },
  )
}
