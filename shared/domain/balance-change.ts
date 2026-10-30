import { z } from 'zod'
import { DecimalSchema, UtcSchema } from '../contracts/config.ts'
import { decimalDifference } from './decimal.ts'
const Point = z.strictObject({
  sourceId: z.string().min(1).max(64),
  seriesRevision: z.string().min(1).max(128),
  currency: z.string().regex(/^[A-Z]{3}$/),
  at: UtcSchema,
  total: DecimalSchema,
  granted: DecimalSchema,
  toppedUp: DecimalSchema,
})
export type BalancePoint = z.infer<typeof Point>
/** Two observations describe net movement, never gross spending, top-ups or an official bill. */
export function balanceChange(
  previous: BalancePoint | null,
  current: BalancePoint,
  expectedIntervalSeconds: number,
) {
  const next = Point.parse(current)
  if (
    !Number.isInteger(expectedIntervalSeconds) ||
    expectedIntervalSeconds < 60 ||
    expectedIntervalSeconds > 86400
  )
    throw new Error('INVALID_INTERVAL')
  if (previous === null) return null
  const before = Point.parse(previous)
  if (
    before.sourceId !== next.sourceId ||
    before.seriesRevision !== next.seriesRevision ||
    before.currency !== next.currency ||
    before.at >= next.at
  )
    throw new Error('INCOMPARABLE_BALANCE_POINTS')
  const net = decimalDifference(next.total, before.total),
    grantedNet = decimalDifference(next.granted, before.granted),
    paidNet = decimalDifference(next.toppedUp, before.toppedUp)
  return {
    kind: 'net_balance_change' as const,
    from: before.at,
    to: next.at,
    currency: next.currency,
    net,
    grantedNet,
    paidNet,
    coverageGap: Date.parse(next.at) - Date.parse(before.at) > expectedIntervalSeconds * 2000,
    grantDecreaseCause: grantedNet.startsWith('-') ? 'consumption_or_expiry_unknown' : null,
    paidIncrease: !paidNet.startsWith('-') && paidNet !== '0',
    officialSpend: null,
  }
}
