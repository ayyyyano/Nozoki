import { z } from 'zod'
import { mac, hex, tokenValid } from './auth-crypto.ts'
export class AuthError extends Error {
  status: number
  code: string
  retryAfter?: number
  constructor(status: number, code: string, retryAfter?: number) {
    super(code)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}
export type AuthEnvironment = Record<string, unknown>
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
export async function authSettings(env: AuthEnvironment) {
  const email = typeof env.ADMIN_EMAIL === 'string' ? env.ADMIN_EMAIL.trim().toLowerCase() : ''
  const password = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD : ''
  const version =
    typeof env.AUTH_VERSION === 'string' && /^[1-9]\d{0,8}$/.test(env.AUTH_VERSION)
      ? Number(env.AUTH_VERSION)
      : 0
  let origin: URL
  try {
    origin = new URL(String(env.AUTH_ORIGIN ?? ''))
  } catch {
    throw new AuthError(503, 'AUTH_UNAVAILABLE')
  }
  const local =
    origin.protocol === 'http:' && loopback(origin.hostname) && env.AUTH_ALLOW_LOCAL_HTTP === '1'
  if (
    !z.email().safeParse(email).success ||
    email.length > 254 ||
    password.length < 12 ||
    password.length > 1024 ||
    password === 'REPLACE_WITH_A_LOCAL_DEVELOPMENT_PASSWORD' ||
    !version ||
    (!local && origin.protocol !== 'https:') ||
    origin.href !== origin.origin + '/' ||
    origin.username ||
    origin.password
  )
    throw new AuthError(503, 'AUTH_UNAVAILABLE')
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key])
    if (!Number.isInteger(value) || value < min || value > max)
      throw new AuthError(503, 'AUTH_UNAVAILABLE')
    return value
  }
  const absolute = number('AUTH_ABSOLUTE_SECONDS', 43200, 3600, 604800)
  const idle = number('AUTH_IDLE_SECONDS', 1800, 300, absolute)
  const touch = number('AUTH_TOUCH_SECONDS', 300, 30, Math.floor(idle / 2))
  // Independent random Secret: stored limiter tags must not be password verifiers.
  const rateSecret =
    typeof env.AUTH_RATE_LIMIT_SECRET === 'string' ? env.AUTH_RATE_LIMIT_SECRET : ''
  if (!tokenValid(rateSecret)) throw new AuthError(503, 'AUTH_UNAVAILABLE')
  const rateKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(rateSecret.replaceAll('-', '+').replaceAll('_', '/') + '='), (c) =>
      c.charCodeAt(0),
    ),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  // Password is length-delimited message data, never an HMAC key (key padding aliases NUL suffixes).
  const credentialTag = await mac(rateKey, ['nozoki-password-check-v1', email, password])
  const passwordBinding = hex(credentialTag)
  const fingerprint = hex(
    await mac(rateKey, ['nozoki-identity-v1', email, String(version), passwordBinding]),
  )
  return {
    email,
    version,
    credentialTag,
    rateKey,
    fingerprint,
    origin: origin.origin,
    local,
    trustCfIp: env.AUTH_TRUST_CF_IP === '1' && !local,
    absolute,
    idle,
    touch,
  }
}
export type AuthSettings = Awaited<ReturnType<typeof authSettings>>
