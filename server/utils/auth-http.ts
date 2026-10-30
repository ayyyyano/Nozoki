import {
  defineEventHandler,
  getHeader,
  getRequestURL,
  getRequestWebStream,
  setCookie,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from 'h3'
import {
  authSettings,
  AuthError,
  type AuthEnvironment,
  type AuthSettings,
} from '../services/auth-settings.ts'
import { getDatabase } from './database.ts'
import { findSession, checkCsrf, type AuthSession } from '../services/sessions.ts'
type Platform = { env?: AuthEnvironment; request?: Request & { cf?: { colo?: unknown } } }
function platform(event: H3Event): Platform {
  return (
    event.context.nozokiNode ??
    event.context.cloudflare ??
    event.context._platform?.cloudflare ??
    {}
  )
}
export function environment(event: H3Event): AuthEnvironment {
  return platform(event).env ?? {}
}
export const cookieName = (settings: AuthSettings) =>
  settings.local ? 'nozoki_dev_session' : '__Host-nozoki_session'
export function sessionCookie(event: H3Event, settings: AuthSettings): string | undefined {
  const name = cookieName(settings),
    items = (getHeader(event, 'cookie') ?? '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(name + '='))
  return items.length === 1 ? items[0]!.slice(name.length + 1) : undefined
}
export function writeSessionCookie(
  event: H3Event,
  settings: AuthSettings,
  token: string,
  maxAge: number,
) {
  setCookie(event, cookieName(settings), token, {
    httpOnly: true,
    secure: !settings.local,
    sameSite: 'strict',
    path: '/',
    maxAge,
  })
}
export function assertOrigin(event: H3Event, settings: AuthSettings) {
  const url =
    platform(event).request?.url ??
    getRequestURL(event, { xForwardedHost: false, xForwardedProto: false }).href
  if (
    new URL(url).origin !== settings.origin ||
    getHeader(event, 'origin') !== settings.origin ||
    ['cross-site', 'same-site'].includes(getHeader(event, 'sec-fetch-site') ?? '')
  )
    throw new AuthError(403, 'ORIGIN_REJECTED')
}
export function trustedSource(event: H3Event, settings: AuthSettings): string {
  // Header trust is opt-in only for a directly exposed Cloudflare edge Worker.
  // Local/proxied/unknown deployments share a conservative bucket; XFF is never used.
  const request = platform(event).request
  if (!settings.trustCfIp || typeof request?.cf?.colo !== 'string')
    return settings.local ? 'loopback' : 'unknown-source'
  const ip = request.headers.get('cf-connecting-ip') ?? ''
  if (ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return 'unknown-source'
  return 'cf:' + ip.toLowerCase()
}
export async function boundedJson(event: H3Event, limit = 4096): Promise<unknown> {
  if (
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(getHeader(event, 'content-type') ?? '') ||
    !['', 'identity'].includes(getHeader(event, 'content-encoding') ?? '')
  )
    throw new AuthError(415, 'INVALID_REQUEST')
  const length = getHeader(event, 'content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new AuthError(413, 'INVALID_REQUEST')
  const reader = getRequestWebStream(event)?.getReader()
  if (!reader) throw new AuthError(400, 'INVALID_REQUEST')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > limit) {
        await reader.cancel()
        throw new AuthError(413, 'INVALID_REQUEST')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch (e) {
    if (e instanceof AuthError) throw e
    throw new AuthError(400, 'INVALID_REQUEST')
  } finally {
    reader.releaseLock()
  }
}
export async function identity(event: H3Event, touch = true): Promise<AuthSession | null> {
  if (
    !(getHeader(event, 'cookie') ?? '')
      .split(';')
      .some((v) => /^\s*(?:__Host-nozoki_session|nozoki_dev_session)=/.test(v))
  )
    return null
  let settings: AuthSettings
  try {
    settings = await authSettings(environment(event))
  } catch {
    return null
  }
  const target =
    platform(event).request?.url ??
    getRequestURL(event, { xForwardedHost: false, xForwardedProto: false }).href
  if (new URL(target).origin !== settings.origin) return null
  const token = sessionCookie(event, settings)
  if (!token) return null
  return findSession(getDatabase(event), token, settings, new Date(), touch)
}
export function authEndpoint(handler: (event: H3Event) => Promise<unknown>) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, 'Cache-Control', 'no-store')
    setResponseHeader(event, 'Vary', 'Cookie')
    try {
      return await handler(event)
    } catch (e) {
      const error = e instanceof AuthError ? e : new AuthError(503, 'AUTH_UNAVAILABLE')
      setResponseStatus(event, error.status)
      if (error.retryAfter) setResponseHeader(event, 'Retry-After', error.retryAfter)
      return {
        code: error.code,
        message:
          error.code === 'INVALID_CREDENTIALS'
            ? '邮箱或密码错误'
            : error.code === 'LOGIN_LIMITED'
              ? '登录暂时受限，请稍后重试'
              : '请求无法完成',
      }
    }
  })
}
export async function authenticatedMutation(event: H3Event): Promise<AuthSession> {
  const settings = await authSettings(environment(event))
  assertOrigin(event, settings)
  const session = await identity(event, false)
  if (!session) throw new AuthError(401, 'AUTH_REQUIRED')
  await checkCsrf(session, getHeader(event, 'x-nozoki-csrf'))
  return session
}
