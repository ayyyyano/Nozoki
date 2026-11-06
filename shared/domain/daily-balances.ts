import { addDays, dayStart, localClock } from '../schedule/timezone.ts'

/** Calendar days in the site's zone, including DST-short/long days. */
export function balanceDays(now: Date | number, timezone: string) {
  const today = localClock(now, timezone).date
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    return {
      day,
      start: new Date(dayStart(day, timezone)).toISOString(),
      end: new Date(dayStart(addDays(day, 1), timezone)).toISOString(),
    }
  })
}

/** Bring the final pre-midnight sample forward even for a long refresh interval.
 * The existing five-minute Cron remains responsible for actually running it. */
export function nextBalanceCollection(now: number, interval: number, timezone: string) {
  const date = localClock(now, timezone).date,
    end = dayStart(addDays(date, 1), timezone),
    closingSample = end - 300000,
    normal = now + Math.max(300, interval) * 1000
  return new Date(Math.min(normal, closingSample > now ? closingSample : end)).toISOString()
}
