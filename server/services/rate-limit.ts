import type { Database } from '../types/database.ts'
import type { AuthSettings } from './auth-settings.ts'
import { AuthError } from './auth-settings.ts'
import { mac, hex } from './auth-crypto.ts'
export interface Attempt {
  hash: string
  start: string
  limit: number
}
/** Reserve before password work. Pending attempts count conservatively; success refunds only its own slot. */
export async function reserveLogin(
  db: Database,
  settings: AuthSettings,
  source: string,
  now = new Date(),
): Promise<Attempt[]> {
  const time = now.toISOString()
  const buckets = await Promise.all(
    [
      ['account', settings.email, 5, 300],
      ['source', source, 20, 60],
    ].map(async ([scope, identity, limit, seconds]) => ({
      hash: hex(
        await mac(settings.rateKey, [
          'nozoki-limit-v1',
          String(settings.version),
          String(scope),
          String(identity),
        ]),
      ),
      limit: Number(limit),
      end: new Date(now.getTime() + Number(seconds) * 1000).toISOString(),
    })),
  )
  const result = await db.batch(
    buckets.map((b) =>
      db
        .prepare(
          `INSERT INTO login_limits(key_hash,failures,window_started_at,blocked_until,expires_at) VALUES(?,1,?,NULL,?)
    ON CONFLICT(key_hash) DO UPDATE SET
      failures=CASE WHEN login_limits.expires_at<=? THEN 1 ELSE login_limits.failures+1 END,
      window_started_at=CASE WHEN login_limits.expires_at<=? THEN excluded.window_started_at ELSE login_limits.window_started_at END,
      blocked_until=CASE WHEN login_limits.expires_at<=? THEN NULL WHEN login_limits.failures+1>=? THEN login_limits.expires_at ELSE NULL END,
      expires_at=CASE WHEN login_limits.expires_at<=? THEN excluded.expires_at ELSE login_limits.expires_at END
    WHERE login_limits.expires_at<=? OR login_limits.failures<? RETURNING window_started_at,expires_at`,
        )
        .bind(b.hash, time, b.end, time, time, time, b.limit, time, time, b.limit),
    ),
  )
  if (result.some((r) => r.results.length !== 1)) {
    const rows = await db.batch(
      buckets.map((b) =>
        db.prepare('SELECT expires_at FROM login_limits WHERE key_hash=?').bind(b.hash),
      ),
    )
    const retry = Math.max(
      1,
      ...rows.flatMap((r, i) =>
        result[i]!.results.length
          ? []
          : r.results.map((row) =>
              Math.ceil((Date.parse(String(row.expires_at)) - now.getTime()) / 1000),
            ),
      ),
    )
    throw new AuthError(429, 'LOGIN_LIMITED', retry)
  }
  return buckets.map((b, i) => ({
    hash: b.hash,
    start: String(result[i]!.results[0]!.window_started_at),
    limit: b.limit,
  }))
}
export function refundStatements(db: Database, attempts: Attempt[]) {
  return attempts.map((a) =>
    db
      .prepare(
        'UPDATE login_limits SET failures=max(0,failures-1),blocked_until=CASE WHEN failures-1<? THEN NULL ELSE blocked_until END WHERE key_hash=? AND window_started_at=?',
      )
      .bind(a.limit, a.hash, a.start),
  )
}
