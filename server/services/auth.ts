import { z } from 'zod'
import type { Database } from '../types/database.ts'
import type { AuthSettings } from './auth-settings.ts'
import { AuthError } from './auth-settings.ts'
import { bytes, hmacKey, mac, randomToken, hashToken, tokenValid, hex } from './auth-crypto.ts'
import { reserveLogin, refundStatements } from './rate-limit.ts'
import { insertSession, revokeSession } from '../repositories/sessions.ts'
export const LoginSchema = z.strictObject({
  email: z
    .string()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(1024),
})
export async function login(
  db: Database,
  settings: AuthSettings,
  body: unknown,
  source: string,
  previousToken?: string,
  now = new Date(),
) {
  const attempts = await reserveLogin(db, settings, source, now)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) throw new AuthError(401, 'INVALID_CREDENTIALS')
  // Native fixed-size tag verification; password stays exact JSON message data.
  // Both wrong-email and wrong-password paths perform the same verification.
  const valid = await crypto.subtle.verify(
    'HMAC',
    settings.rateKey,
    settings.credentialTag,
    bytes(JSON.stringify(['nozoki-password-check-v1', parsed.data.email, parsed.data.password])),
  )
  if (!valid) throw new AuthError(401, 'INVALID_CREDENTIALS')
  const token = randomToken(),
    hash = await hashToken(token),
    time = now.toISOString()
  const expires = new Date(now.getTime() + settings.absolute * 1000).toISOString(),
    idle = new Date(now.getTime() + settings.idle * 1000).toISOString()
  const statements = insertSession(
    db,
    hash,
    settings.version,
    hex(await mac(await hmacKey(token), ['nozoki-session-binding-v1', settings.fingerprint])),
    time,
    expires,
    idle,
  )
  if (previousToken && tokenValid(previousToken))
    statements.push(revokeSession(db, await hashToken(previousToken), time))
  statements.push(...refundStatements(db, attempts))
  await db.batch(statements)
  return { token, expires, maxAge: settings.absolute }
}
