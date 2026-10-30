import type { Database, D1Statement } from '../types/database.ts'
export function sessionRow(db: Database, hash: string) {
  return db
    .prepare(
      'SELECT s.*,b.auth_fingerprint FROM sessions s JOIN session_bindings b ON b.token_hash=s.token_hash WHERE s.token_hash=?',
    )
    .bind(hash)
    .first()
}
export function insertSession(
  db: Database,
  hash: string,
  version: number,
  fingerprint: string,
  created: string,
  expires: string,
  idle: string,
): D1Statement[] {
  return [
    db
      .prepare(
        'INSERT INTO sessions(token_hash,auth_version,created_at,last_seen_at,expires_at,idle_expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)',
      )
      .bind(hash, version, created, created, expires, idle),
    db
      .prepare('INSERT INTO session_bindings(token_hash,auth_fingerprint) VALUES(?,?)')
      .bind(hash, fingerprint),
  ]
}
export function revokeSession(db: Database, hash: string, now: string) {
  return db
    .prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
    .bind(now, hash)
}
