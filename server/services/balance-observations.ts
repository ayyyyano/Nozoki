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
  // Same result as the former window join: per local day and currency, the newest sample.
  // One narrow index range query per day instead of one OR-scan over the full history.
  const statements = days.map((d) =>
    db
      .prepare(
        `SELECT ? AS day,currency,total,collected_at FROM (
    SELECT currency,total,collected_at,
      row_number() OVER(PARTITION BY currency ORDER BY collected_at DESC) AS position
    FROM (
      SELECT currency,total,collected_at FROM balance_observations
      WHERE source_id=? AND account_series=? AND collected_at>=? AND collected_at<? AND collected_at<=?
      UNION ALL
      SELECT currency,total,collected_at FROM balance_observations
      WHERE source_id=? AND account_series IS NULL AND series_revision=? AND collected_at>=? AND collected_at<? AND collected_at<=?
    )
  ) WHERE position=1`,
      )
      .bind(
        d.day,
        sourceId,
        seriesRevision,
        d.start,
        d.end,
        now.toISOString(),
        sourceId,
        legacySeries ?? seriesRevision,
        d.start,
        d.end,
        now.toISOString(),
      ),
  )
  const rows = (await db.batch(statements)).flatMap(
    (r) =>
      r.results as {
        day: string
        currency: string
        total: string
        collected_at: string
      }[],
  )
  rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.currency < b.currency ? -1 : 1))
  return rows.map((r) => ({
    day: r.day,
    currency: r.currency,
    total: r.total,
    collectedAt: r.collected_at,
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
