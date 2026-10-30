import type { PreparedSchedule, ScheduleEvaluation, ResolvedDay, ResolvedPeriod } from './types.ts'
import { addDays, dayStart, epoch, localClock } from './timezone.ts'
import { normalizeSchedule, scheduleIssues } from './normalize.ts'
import { assertNoAbsoluteOverlap, resolveDay } from './resolve.ts'
function phaseAt(
  day: ResolvedDay,
  current: ResolvedPeriod | null,
  ms: number,
): ScheduleEvaluation['phase'] {
  if (current) return 'period'
  if (day.restDay) return 'rest'
  const own = day.periods.filter((p) => p.startDayOffset === 0)
  return !own.length
    ? 'empty'
    : ms < own[0]!.startMs
      ? 'before'
      : ms >= own.at(-1)!.endMs
        ? 'after'
        : 'between'
}
export function prepareSchedule(
  value: unknown,
  anchorDate: string,
  options: { horizonDays?: number } = {},
): PreparedSchedule {
  const schedule = normalizeSchedule(value),
    horizonDays = options.horizonDays ?? 14
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366)
    throw new RangeError('Search horizon must be 1–366 days')
  const prepared: PreparedSchedule = {
    kind: 'prepared-schedule',
    schedule,
    anchorDate,
    horizonDays,
    days: [],
    periods: [],
    events: [],
    issues: [],
  }
  for (let offset = -1; offset <= horizonDays; offset++) {
    const date = addDays(anchorDate, offset)
    try {
      const day = resolveDay(schedule, date)
      prepared.days.push(day)
      prepared.periods.push(...day.periods)
    } catch (error) {
      prepared.issues.push(...scheduleIssues(error).map((i) => ({ ...i, date })))
    }
  }
  prepared.periods.sort((a, b) => a.startMs - b.startMs)
  try {
    assertNoAbsoluteOverlap(prepared.periods)
  } catch (error) {
    prepared.issues.push(...scheduleIssues(error))
  }
  for (const day of prepared.days) {
    const previous = prepared.days.find((d) => d.date === addDays(day.date, -1))
    const start = dayStart(day.date, schedule.timezone)
    const end = dayStart(addDays(day.date, 1), schedule.timezone)
    day.carryIn = previous?.periods.filter((p) => p.endMs > start && p.startMs < end) ?? []
  }
  for (const period of prepared.periods)
    prepared.events.push(
      { kind: 'start', at: period.startAt, atMs: period.startMs, period },
      { kind: 'end', at: period.endAt, atMs: period.endMs, period },
    )
  for (const day of prepared.days) {
    const previous = prepared.days.find((d) => d.date === addDays(day.date, -1))
    if (!previous) continue
    const boundary = dayStart(day.date, schedule.timezone)
    const before =
      prepared.periods.find((p) => p.startMs <= boundary - 1 && boundary - 1 < p.endMs) ?? null
    const after = prepared.periods.find((p) => p.startMs <= boundary && boundary < p.endMs) ?? null
    if (!before && !after && phaseAt(previous, null, boundary - 1) !== phaseAt(day, null, boundary))
      prepared.events.push({
        kind: 'day-boundary',
        at: new Date(boundary).toISOString(),
        atMs: boundary,
        period: null,
      })
  }
  for (const [key, kind] of [
    ['startAt', 'override-start'],
    ['endAt', 'override-end'],
  ] as const) {
    const at = schedule.override?.[key]
    if (at) prepared.events.push({ kind, at, atMs: epoch(at), period: null })
  }
  prepared.events.sort((a, b) => a.atMs - b.atMs || (a.kind === 'end' ? -1 : 1))
  return prepared
}
export function evaluateSchedule(
  value: unknown,
  now: Date | number | string,
  options: { horizonDays?: number } = {},
): ScheduleEvaluation {
  const invalid = (issues: ScheduleEvaluation['issues']): ScheduleEvaluation => ({
    valid: false,
    state: 'invalid',
    phase: 'invalid',
    timezone: '',
    localDate: '',
    clock: '',
    day: null,
    current: null,
    nextChange: null,
    nextPeriod: null,
    remainingMs: null,
    progressPercent: null,
    exception: false,
    override: null,
    searchExhausted: false,
    issues,
  })
  try {
    const ms = epoch(now)
    const prepared =
      value && typeof value === 'object' && 'kind' in value && value.kind === 'prepared-schedule'
        ? (value as PreparedSchedule)
        : null
    const schedule = prepared?.schedule ?? normalizeSchedule(value),
      clock = localClock(ms, schedule.timezone)
    const plan = prepared ?? prepareSchedule(schedule, clock.date, options)
    if (plan.anchorDate !== clock.date)
      throw new RangeError('Prepared schedule must use the current local date')
    if (plan.issues.length)
      return {
        ...invalid(plan.issues),
        timezone: schedule.timezone,
        localDate: clock.date,
        clock: clock.clock,
      }
    const day = plan.days.find((d) => d.date === clock.date)!,
      current = plan.periods.find((p) => p.startMs <= ms && ms < p.endMs) ?? null
    const nextPeriod = plan.periods.find((p) => p.startMs > ms && p.category !== 'free') ?? null
    const override =
      schedule.override &&
      (!schedule.override.startAt || epoch(schedule.override.startAt) <= ms) &&
      (!schedule.override.endAt || ms < epoch(schedule.override.endAt))
        ? schedule.override
        : null
    const nextChange = plan.events.find((e) => e.atMs > ms) ?? null
    const phase = phaseAt(day, current, ms)
    return {
      valid: true,
      state: current?.category ?? (day.restDay ? 'rest' : 'free'),
      phase,
      timezone: schedule.timezone,
      localDate: clock.date,
      clock: clock.clock,
      day,
      current,
      nextChange,
      nextPeriod,
      remainingMs: nextChange ? Math.max(0, nextChange.atMs - ms) : null,
      progressPercent: current
        ? Math.max(
            0,
            Math.min(100, ((ms - current.startMs) / (current.endMs - current.startMs)) * 100),
          )
        : null,
      exception: day.exception,
      override,
      searchExhausted: nextPeriod === null,
      issues: [],
    }
  } catch (error) {
    return invalid(scheduleIssues(error))
  }
}
export function getUpcomingEvents(
  value: unknown,
  now: Date | number | string,
  options: { horizonDays?: number; limit?: number } = {},
) {
  const schedule = normalizeSchedule(value),
    clock = localClock(now, schedule.timezone),
    plan = prepareSchedule(schedule, clock.date, options)
  const limit = options.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('Event limit must be 1–100')
  return {
    events: plan.events
      .filter((e) => e.atMs > epoch(now) && e.kind !== 'day-boundary')
      .slice(0, limit),
    issues: plan.issues,
    horizonDays: plan.horizonDays,
  }
}
