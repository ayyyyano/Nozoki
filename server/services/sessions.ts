import { z } from 'zod'
import { UtcSchema } from '../../shared/contracts/config.ts'
import type { Database } from '../types/database.ts'
import { AuthError, type AuthSettings } from './auth-settings.ts'
import { hashToken, tokenValid, unhex, verifyMac, mac, hex, hmacKey } from './auth-crypto.ts'
import { sessionRow } from '../repositories/sessions.ts'
const Row = z.object({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  auth_version: z.number().int(),
  auth_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: UtcSchema,
  last_seen_at: UtcSchema,
  expires_at: UtcSchema,
  idle_expires_at: UtcSchema,
  revoked_at: UtcSchema.nullable(),
})
export type AuthSession = { hash: string; settings: AuthSettings; expiresAt: string }
export async function findSession(
  db: Database,
  token: string | undefined,
  settings: AuthSettings,
  now = new Date(),
  touch = true,
): Promise<AuthSession | null> {
  if (!token || !tokenValid(token)) return null
  const hash = await hashToken(token),
    value = await sessionRow(db, hash)
  if (!value) return null
  const parsed = Row.safeParse(value)
  if (!parsed.success) throw new AuthError(503, 'AUTH_UNAVAILABLE')
  const row = parsed.data,
    time = now.toISOString()
  if (
    row.revoked_at ||
    row.auth_version !== settings.version ||
    row.expires_at <= time ||
    row.idle_expires_at <= time ||
    row.created_at > time ||
    !(await verifyMac(
      await hmacKey(token),
      ['nozoki-session-binding-v1', settings.fingerprint],
      unhex(row.auth_fingerprint),
    ))
  )
    return null
  if (touch && now.getTime() - Date.parse(row.last_seen_at) >= settings.touch * 1000) {
    const idle = new Date(
      Math.min(Date.parse(row.expires_at), now.getTime() + settings.idle * 1000),
    ).toISOString()
    const result = await db
      .prepare(
        'UPDATE sessions SET last_seen_at=?,idle_expires_at=? WHERE token_hash=? AND auth_version=? AND EXISTS(SELECT 1 FROM session_bindings b WHERE b.token_hash=sessions.token_hash AND b.auth_fingerprint=?) AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>? AND last_seen_at<=?',
      )
      .bind(
        time,
        idle,
        hash,
        settings.version,
        row.auth_fingerprint,
        time,
        time,
        new Date(now.getTime() - settings.touch * 1000).toISOString(),
      )
      .run()
    // Another request may have touched it first. Revalidate without another write;
    // revocation/expiry still deny access, a successful concurrent touch does not.
    if (result.meta.changes !== 1) return findSession(db, token, settings, now, false)
  }
  return { hash, settings, expiresAt: row.expires_at }
}
export async function csrfToken(session: AuthSession) {
  return hex(
    await mac(session.settings.rateKey, [
      'nozoki-csrf-v1',
      session.hash,
      session.settings.fingerprint,
    ]),
  )
}
export async function checkCsrf(session: AuthSession, value: string | undefined) {
  if (
    !value ||
    !/^[a-f0-9]{64}$/.test(value) ||
    !(await verifyMac(
      session.settings.rateKey,
      ['nozoki-csrf-v1', session.hash, session.settings.fingerprint],
      unhex(value),
    ))
  )
    throw new AuthError(403, 'CSRF_REJECTED')
}
