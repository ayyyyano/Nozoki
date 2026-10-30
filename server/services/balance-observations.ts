import type { Database } from '../types/database.ts'
import { balanceChange, type BalancePoint } from '../../shared/domain/balance-change.ts'
/** Internal, administrator-authorized callers only. Net movements never enter official daily_usage. */
export async function readBalanceChanges(
  db: Database,
  sourceId: string,
  seriesRevision: string,
  interval: number,
) {
  const rows = (
    await db
      .prepare(
        'SELECT * FROM balance_observations WHERE source_id=? AND series_revision=? ORDER BY collected_at DESC,currency LIMIT 100',
      )
      .bind(sourceId, seriesRevision)
      .all()
  ).results.reverse()
  const prior = new Map<string, BalancePoint>()
  return rows.map((r) => {
    const point: BalancePoint = {
      sourceId,
      seriesRevision,
      currency: r.currency as string,
      at: r.collected_at as string,
      total: r.total as string,
      granted: r.granted as string,
      toppedUp: r.topped_up as string,
    }
    const change = balanceChange(prior.get(point.currency) ?? null, point, interval)
    prior.set(point.currency, point)
    return { point, change, observedAt: r.observed_at }
  })
}
