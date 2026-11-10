import type { Database } from '../types/database.ts'

/** Counts only; never expose snapshot payloads, credential envelopes or upstream responses. */
export async function sourceRemovalState(db: Database, id: string) {
  const results = await db.batch([
    db.prepare('SELECT id FROM integrations WHERE id=?').bind(id),
    db.prepare('SELECT 1 FROM balance_observations WHERE source_id=? LIMIT 1').bind(id),
    db.prepare('SELECT 1 FROM daily_usage WHERE source_id=? LIMIT 1').bind(id),
    db.prepare('SELECT 1 FROM import_batches WHERE source_id=? LIMIT 1').bind(id),
    db.prepare('SELECT 1 FROM codex_usage_days WHERE source_id=? LIMIT 1').bind(id),
    db.prepare('SELECT 1 FROM integration_snapshot_views WHERE source_id=? LIMIT 1').bind(id),
  ])
  return {
    exists: !!results[0]!.results.length,
    protectedHistory: results.slice(1, 5).some((r) => !!r.results.length),
    hasSnapshots: !!results[5]!.results.length,
  }
}
