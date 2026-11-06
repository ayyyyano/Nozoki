import { LegacyScheduleSchema, ScheduleInputSchema, WeeklyScheduleSchema } from './schema.ts'
import { legacyToWeekly } from './legacy.ts'
import { minuteOfDay } from './timezone.ts'
import type {
  DayRule,
  LegacySchedule,
  ScheduleIssue,
  ScheduleInput,
  SchedulePeriod,
  WeeklySchedule,
} from './types.ts'
export function parseScheduleInput(value: unknown): ScheduleInput {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('version' in value) return WeeklyScheduleSchema.parse(value)
    if ('start' in value) return LegacyScheduleSchema.parse(value)
  }
  return ScheduleInputSchema.parse(value) as ScheduleInput
}
export function normalizeSchedule(value: unknown): WeeklySchedule {
  const parsed = parseScheduleInput(value)
  const schedule = (
    'version' in parsed ? parsed : WeeklyScheduleSchema.parse(legacyToWeekly(parsed))
  ) as WeeklySchedule
  const sort = (items: SchedulePeriod[]) =>
    items.sort(
      (a, b) =>
        a.startDayOffset * 1440 +
          minuteOfDay(a.start) -
          b.startDayOffset * 1440 -
          minuteOfDay(b.start) || a.id.localeCompare(b.id),
    )
  const rule = (value: DayRule) => {
    if (value.kind === 'slots') sort(value.slots)
  }
  schedule.templates.forEach((t) => sort(t.slots))
  Object.values(schedule.weekdays).forEach(rule)
  Object.values(schedule.exceptions).forEach((e) => rule(e.rule))
  return schedule
}
export function scheduleIssues(error: unknown): ScheduleIssue[] {
  const value = error as { issues?: { path: PropertyKey[]; message: string }[]; message?: string }
  return (
    value?.issues
      ?.slice(0, 50)
      .map((i) => ({ code: 'INVALID_CONFIG', path: i.path.join('.'), message: i.message })) ?? [
      {
        code: value?.message?.includes('LOCAL_TIME') ? value.message : 'INVALID_CONFIG',
        path: '',
        message: value?.message ?? 'Invalid schedule',
      },
    ]
  )
}
export function validateSchedule(
  value: unknown,
):
  | { valid: true; schedule: WeeklySchedule; issues: [] }
  | { valid: false; schedule: null; issues: ScheduleIssue[] } {
  try {
    return { valid: true, schedule: normalizeSchedule(value), issues: [] }
  } catch (error) {
    return { valid: false, schedule: null, issues: scheduleIssues(error) }
  }
}
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? '[' + v.map(canonical).join(',') + ']'
    : v && typeof v === 'object'
      ? '{' +
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
          .join(',') +
        '}'
      : JSON.stringify(v)
/** Returns null when a basic form would discard weekly rules, labels or exceptions. */
export function toLegacySchedule(value: unknown): LegacySchedule | null {
  try {
    const parsed = parseScheduleInput(value)
    if (!('version' in parsed)) return parsed
    const schedule = normalizeSchedule(parsed),
      t = schedule.templates.find((t) => t.id === 'workday'),
      morning = t?.slots.find((p) => p.id === 'morning'),
      lunch = t?.slots.find((p) => p.id === 'lunch'),
      afternoon = t?.slots.find((p) => p.id === 'afternoon')
    if (!t || !lunch || schedule.override) return null
    const candidate: LegacySchedule = {
      ...(schedule.labels === undefined ? {} : { labels: { ...schedule.labels } }),
      timezone: schedule.timezone,
      start: morning?.start ?? lunch.start,
      end: afternoon?.end ?? lunch.end,
      lunchStart: lunch.start,
      lunchEnd: lunch.end,
      restMode: schedule.weekdays['6'].kind === 'rest' ? 'double' : 'single',
      calendarVersion: schedule.calendarVersion,
      ...(Object.keys(schedule.exceptions).length
        ? {
            calendar: Object.fromEntries(
              Object.entries(schedule.exceptions).map(([date, e]) => [
                date,
                {
                  workday: e.rule.kind === 'template',
                  ...(e.name === undefined ? {} : { name: e.name }),
                },
              ]),
            ),
          }
        : {}),
    }
    return canonical(normalizeSchedule(candidate)) === canonical(schedule) ? candidate : null
  } catch {
    return null
  }
}
export function removeScheduleTemplate(value: WeeklySchedule, id: string): WeeklySchedule {
  if (
    [...Object.values(value.weekdays), ...Object.values(value.exceptions).map((e) => e.rule)].some(
      (r) => r.kind === 'template' && r.templateId === id,
    )
  )
    throw new RangeError('TEMPLATE_IN_USE')
  return {
    ...structuredClone(value),
    templates: structuredClone(value.templates.filter((t) => t.id !== id)),
  }
}
export function sortSchedulePeriods(value: SchedulePeriod[]): SchedulePeriod[] {
  return structuredClone(value).sort(
    (a, b) =>
      a.startDayOffset * 1440 +
        minuteOfDay(a.start) -
        b.startDayOffset * 1440 -
        minuteOfDay(b.start) || a.id.localeCompare(b.id),
  )
}
