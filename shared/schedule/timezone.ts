import { Temporal } from '@js-temporal/polyfill'
import type { DstDisambiguation, Weekday } from './types.ts'
export function epoch(now: Date | number | string): number {
  const value =
    now instanceof Date
      ? now.getTime()
      : typeof now === 'number'
        ? now
        : Temporal.Instant.from(now).epochMilliseconds
  if (!Number.isFinite(value)) throw new RangeError('Invalid instant')
  return value
}
export function isTimeZone(value: string): boolean {
  if (!value.includes('/') && value !== 'UTC') return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}
export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    return Temporal.PlainDate.from(value).toString() === value
  } catch {
    return false
  }
}
export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString()
}
export function weekday(date: string): Weekday {
  return String(Temporal.PlainDate.from(date).dayOfWeek) as Weekday
}
export function localClock(now: Date | number | string, timezone: string) {
  const time = Temporal.Instant.fromEpochMilliseconds(epoch(now)).toZonedDateTimeISO(timezone)
  return {
    date: time.toPlainDate().toString(),
    clock: time.toPlainTime().toString({ smallestUnit: 'second' }),
    weekday: String(time.dayOfWeek) as Weekday,
  }
}
export function localInstant(
  date: string,
  time: string,
  timezone: string,
  policy: DstDisambiguation = 'reject',
): number {
  const wall = Temporal.PlainDateTime.from(`${date}T${time}`)
  try {
    return wall.toZonedDateTime(timezone, { disambiguation: 'reject' }).epochMilliseconds
  } catch {
    /* Classify a gap or overlap below. */
  }
  const earlier = wall.toZonedDateTime(timezone, { disambiguation: 'earlier' })
  const later = wall.toZonedDateTime(timezone, { disambiguation: 'later' })
  if (!wall.equals(earlier.toPlainDateTime()) || !wall.equals(later.toPlainDateTime()))
    throw new RangeError('NONEXISTENT_LOCAL_TIME')
  if (earlier.epochMilliseconds !== later.epochMilliseconds && policy === 'reject')
    throw new RangeError('AMBIGUOUS_LOCAL_TIME')
  return (policy === 'later' ? later : earlier).epochMilliseconds
}
export function dayStart(date: string, timezone: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime(timezone).epochMilliseconds
}
export function minuteOfDay(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return h! * 60 + m!
}
