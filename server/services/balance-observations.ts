import type { Database } from '../types/database.ts'
import { balanceChange, type BalancePoint } from '../../shared/domain/balance-change.ts'
import { balanceDays } from '../../shared/domain/daily-balances.ts'
import type { DeepSeekData } from '../../shared/contracts/dashboard.ts'
import { hashToken } from './auth-crypto.ts'
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import type { CredentialEnvelope } from './credentials.ts'
// Deployments and refresh edits must not reset seven-day history; changing account/target must.
export function balanceSeries(
  source: Pick<IntegrationSettings, 'id' | 'provider' | 'protocolVersion' | 'baseUrl'>,
  envelope: CredentialEnvelope | null,
) {
  return hashToken(
    JSON.stringify([
      source.id,
      source.provider,
      source.protocolVersion,
      source.baseUrl,
      envelope?.ciphertext ?? null,
    ]),
  )
}
/** The last successful sample of each local day, not a bill or an invented closing price. */
export async function readDailyBalances(
  db: Database,
  sourceId: string,
  seriesRevision: string,
  timezone: string,
  now: Date,
  legacySeries?: string,
): Promise<DeepSeekData['dailyBalances']> {
  const days = balanceDays(now, timezone)
  const rows = (
    await db
      .prepare(
        `WITH days(day,start_at,end_at) AS (VALUES ${days.map(() => '(?,?,?)').join(',')}), ranked AS (
    SELECT days.day,b.currency,b.total,b.collected_at,
      row_number() OVER(PARTITION BY days.day,b.currency ORDER BY b.collected_at DESC) AS position
    FROM days JOIN balance_observations b ON b.collected_at>=days.start_at AND b.collected_at<days.end_at
    WHERE b.source_id=? AND (b.account_series=? OR (b.account_series IS NULL AND b.series_revision=?)) AND b.collected_at<=?
  ) SELECT day,currency,total,collected_at FROM ranked WHERE position=1 ORDER BY day,currency LIMIT 140`,
      )
      .bind(
        ...days.flatMap((d) => [d.day, d.start, d.end]),
        sourceId,
        seriesRevision,
        legacySeries ?? seriesRevision,
        now.toISOString(),
      )
      .all()
  ).results
  return rows.map((r) => ({
    day: r.day as string,
    currency: r.currency as string,
    total: r.total as string,
    collectedAt: r.collected_at as string,
  }))
}
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
