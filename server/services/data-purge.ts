import type { Database } from '../types/database.ts'

/** Aggregate history tables only; snapshots and collection runs are also cleared by the reset. */
const PURGE_STATEMENTS = [
  'DELETE FROM balance_observations',
  'DELETE FROM daily_usage',
  'DELETE FROM codex_usage_days',
  "DELETE FROM collection_runs WHERE status<>'running'",
  'DELETE FROM integration_snapshot_views',
] as const

export interface PurgedRows {
  balanceObservations: number
  dailyUsage: number
  codexUsageDays: number
  collectionRuns: number
  snapshotViews: number
}

/** Counts only; never exposes row payloads. Used to preview the destructive reset scope. */
export async function collectedHistoryCounts(db: Database) {
  const results = await db.batch([
    db.prepare('SELECT count(*) AS n FROM balance_observations'),
    db.prepare('SELECT count(*) AS n FROM daily_usage'),
    db.prepare('SELECT count(*) AS n FROM codex_usage_days'),
    db.prepare("SELECT count(*) AS n FROM collection_runs WHERE status<>'running'"),
    db.prepare('SELECT count(*) AS n FROM integration_snapshot_views'),
  ])
  const count = (index: number) => (results[index]!.results[0] as { n: number }).n
  return {
    balanceObservations: count(0),
    dailyUsage: count(1),
    codexUsageDays: count(2),
    collectionRuns: count(3),
    snapshotViews: count(4),
  }
}

/** Destructive: clears collected history after the reset configuration has been committed. */
export async function purgeCollectedHistory(db: Database): Promise<PurgedRows> {
  const results = await db.batch(PURGE_STATEMENTS.map((sql) => db.prepare(sql)))
  return {
    balanceObservations: results[0]!.meta.changes ?? 0,
    dailyUsage: results[1]!.meta.changes ?? 0,
    codexUsageDays: results[2]!.meta.changes ?? 0,
    collectionRuns: results[3]!.meta.changes ?? 0,
    snapshotViews: results[4]!.meta.changes ?? 0,
  }
}
