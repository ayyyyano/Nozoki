import type { Database } from '../types/database.ts'
export interface ConfigRequest {
  scope: string
  key: string
  mac: string
}
export async function savedRequest(db: Database, request: ConfigRequest, now: string) {
  const row = await db
    .prepare(
      'SELECT request_mac,config_version,changed FROM config_requests WHERE scope=? AND request_key=? AND expires_at>?',
    )
    .bind(request.scope, request.key, now)
    .first<{ request_mac: string; config_version: number; changed: number }>()
  if (!row) return null
  return row.request_mac === request.mac
    ? {
        success: true as const,
        configVersion: row.config_version,
        changed: row.changed === 1,
        replayed: true,
      }
    : { success: false as const, code: 'IDEMPOTENCY_CONFLICT' as const }
}
export function requestStatements(
  db: Database,
  request: ConfigRequest,
  version: number,
  changed: boolean,
  now: string,
) {
  return [
    db
      .prepare(
        'DELETE FROM config_requests WHERE rowid IN (SELECT rowid FROM config_requests WHERE expires_at<=? ORDER BY expires_at LIMIT 100)',
      )
      .bind(now),
    db
      .prepare('DELETE FROM config_requests WHERE scope=? AND request_key=? AND expires_at<=?')
      .bind(request.scope, request.key, now),
    db
      .prepare(
        'INSERT INTO config_requests(scope,request_key,request_mac,config_version,changed,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        request.scope,
        request.key,
        request.mac,
        version,
        Number(changed),
        now,
        new Date(Date.parse(now) + 86400000).toISOString(),
      ),
  ]
}
