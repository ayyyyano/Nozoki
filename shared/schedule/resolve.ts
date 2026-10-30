import type { ResolvedDay, ResolvedPeriod, WeeklySchedule } from './types.ts'
import { addDays, dayStart, localInstant, weekday } from './timezone.ts'
import { normalizeSchedule } from './normalize.ts'
import { ruleFor, slotsFor } from './schema.ts'
export function resolveDay(schedule: WeeklySchedule, date: string): ResolvedDay {
  const rule = ruleFor(date, schedule),
    exception = schedule.exceptions[date]
  const periods = slotsFor(rule, schedule)
    .map((p) => {
      const startMs = localInstant(
        addDays(date, p.startDayOffset),
        p.start,
        schedule.timezone,
        schedule.dstDisambiguation,
      )
      const endMs = localInstant(
        addDays(date, p.endDayOffset),
        p.end,
        schedule.timezone,
        schedule.dstDisambiguation,
      )
      if (endMs <= startMs) throw new RangeError('INVALID_ABSOLUTE_PERIOD')
      return {
        ...p,
        originDate: date,
        startMs,
        endMs,
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        exception: !!exception,
      }
    })
    .sort((a, b) => a.startMs - b.startMs)
  return {
    date,
    weekday: weekday(date),
    restDay: rule.kind === 'rest',
    exception: !!exception,
    ...(exception?.name === undefined ? {} : { exceptionName: exception.name }),
    periods,
    carryIn: [],
  }
}
export function resolveScheduleForDate(value: unknown, date: string): ResolvedDay {
  const schedule = normalizeSchedule(value),
    day = resolveDay(schedule, date),
    previous = resolveDay(schedule, addDays(date, -1))
  const start = dayStart(date, schedule.timezone),
    end = dayStart(addDays(date, 1), schedule.timezone)
  day.carryIn = previous.periods.filter((p) => p.endMs > start && p.startMs < end)
  return day
}
export function assertNoAbsoluteOverlap(periods: ResolvedPeriod[]) {
  const sorted = periods.toSorted((a, b) => a.startMs - b.startMs)
  if (sorted.some((p, i) => i > 0 && p.startMs < sorted[i - 1]!.endMs))
    throw new RangeError('OVERLAPPING_ABSOLUTE_PERIODS')
}
