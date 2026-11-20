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
/** DeepSeek's balance_infos currency enum; see server/adapters/deepseek.ts. */
const BALANCE_CURRENCIES = ['CNY', 'USD'] as const

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
  // One reverse index lookup per (day, currency). The former window join scanned every
  // observation in the seven-day window on each dashboard request, which exhausted the
  // free-tier D1 row-read quota under 30-second polling.
  const statements = days.flatMap((d) =>
    BALANCE_CURRENCIES.map((currency) =>
      db
        .prepare(
          `SELECT ? AS day,currency,total,collected_at FROM (
  SELECT currency,total,collected_at FROM (
    SELECT currency,total,collected_at FROM balance_observations
     WHERE source_id=? AND account_series=? AND currency=? AND collected_at>=? AND collected_at<? AND collected_at<=?
     ORDER BY collected_at DESC LIMIT 1)
  UNION ALL
  SELECT currency,total,collected_at FROM (
    SELECT currency,total,collected_at FROM balance_observations
     WHERE source_id=? AND account_series IS NULL AND series_revision=? AND currency=? AND collected_at>=? AND collected_at<? AND collected_at<=?
     ORDER BY collected_at DESC LIMIT 1)
) ORDER BY collected_at DESC LIMIT 1`,
        )
        .bind(
          d.day,
          sourceId,
          seriesRevision,
          currency,
          d.start,
          d.end,
          now.toISOString(),
          sourceId,
          legacySeries ?? seriesRevision,
          currency,
          d.start,
          d.end,
          now.toISOString(),
        ),
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
