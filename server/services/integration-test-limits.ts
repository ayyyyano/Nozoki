import type { Database } from '../types/database.ts'
import type { AuthSession } from './sessions.ts'
import { mac, hex } from './auth-crypto.ts'
import { AuthError } from './auth-settings.ts'
export async function testBucket(session: AuthSession, sourceId: string) {
  return hex(
    await mac(session.settings.rateKey, [
      'nozoki-integration-tests-v1',
      session.settings.email,
      sourceId,
    ]),
  )
}
export async function reserveIntegrationTest(
  db: Database,
  session: AuthSession,
  sourceId: string,
  now = new Date(),
) {
  const time = now.toISOString(),
    end = new Date(now.getTime() + 60000).toISOString()
  const hashes = await Promise.all([
    testBucket(session, 'global'),
    testBucket(session, 'source:' + sourceId),
  ])
  const rows = await db.batch(
    hashes.map((hash, index) =>
      db
        .prepare(
          `INSERT INTO login_limits VALUES(?,1,?,NULL,?)
 ON CONFLICT(key_hash) DO UPDATE SET
 failures=CASE WHEN expires_at<=? THEN 1 ELSE failures+1 END,
 window_started_at=CASE WHEN expires_at<=? THEN excluded.window_started_at ELSE window_started_at END,
 blocked_until=CASE WHEN expires_at<=? THEN NULL ELSE blocked_until END,
 expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
 WHERE expires_at<=? OR (failures<? AND (blocked_until IS NULL OR blocked_until<=?)) RETURNING expires_at`,
        )
        .bind(hash, time, end, time, time, time, time, time, index === 0 ? 6 : 2, time),
    ),
  )
  if (rows.some((r) => !r.results.length)) {
    const limits = await db.batch(
      hashes.map((hash) =>
        db.prepare('SELECT expires_at FROM login_limits WHERE key_hash=?').bind(hash),
      ),
    )
    const retry = Math.max(
      1,
      ...limits.flatMap((r) =>
        r.results.map((v) => Math.ceil((Date.parse(String(v.expires_at)) - now.getTime()) / 1000)),
      ),
    )
    throw new AuthError(429, 'TEST_LIMITED', retry)
  }
  const token = crypto.randomUUID(),
    expires = new Date(now.getTime() + 15000).toISOString()
  const slot = await db
    .prepare(
      'UPDATE integration_test_slots SET request_token=?,expires_at=? WHERE id=(SELECT id FROM integration_test_slots WHERE expires_at<=? ORDER BY id LIMIT 1) RETURNING id',
    )
    .bind(token, expires, time)
    .first<{ id: number }>()
  if (!slot) throw new AuthError(429, 'TEST_BUSY', 15)
  return { id: slot.id, token, sourceHash: hashes[1]! }
}
export async function releaseIntegrationTest(db: Database, slot: { id: number; token: string }) {
  await db
    .prepare(
      "UPDATE integration_test_slots SET request_token=NULL,expires_at='1970-01-01T00:00:00.000Z' WHERE id=? AND request_token=?",
    )
    .bind(slot.id, slot.token)
    .run()
}
export async function deferIntegrationTest(
  db: Database,
  hash: string,
  seconds: number,
  now = new Date(),
) {
  const end = new Date(now.getTime() + seconds * 1000).toISOString()
  await db
    .prepare(
      'UPDATE login_limits SET failures=max(failures,2),blocked_until=max(expires_at,?),expires_at=max(expires_at,?) WHERE key_hash=?',
    )
    .bind(end, end, hash)
    .run()
}
