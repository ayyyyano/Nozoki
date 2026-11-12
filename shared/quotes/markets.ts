import { Temporal } from '@js-temporal/polyfill'

export const US_QUOTE_MARKETS = ['US', 'NASDAQ', 'NYSE', 'AMEX', 'ARCA']
export const A_SHARE_QUOTE_MARKETS = ['CN', 'SH', 'SSE', 'SZ', 'SZSE']

const us = { timeZone: 'America/New_York', closeHour: 16 }
const aShares = { timeZone: 'Asia/Shanghai', closeHour: 15 }

/** Regular weekday sessions. Use the market's local date so US daylight saving applies. */
export function latestMarketClose(market: string, now: Date): number | null {
  const session = US_QUOTE_MARKETS.includes(market)
    ? us
    : A_SHARE_QUOTE_MARKETS.includes(market)
      ? aShares
      : null
  if (!session) return null

  const { timeZone, closeHour } = session
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone)
  let day = local.toPlainDate()
  if (local.hour < closeHour) day = day.subtract({ days: 1 })
  while (day.dayOfWeek > 5) day = day.subtract({ days: 1 })
  return day.toZonedDateTime({ timeZone, plainTime: { hour: closeHour } }).epochMilliseconds
}
