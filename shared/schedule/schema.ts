import { z } from 'zod'
import type { DayRule, LegacySchedule, SchedulePeriod, WeeklySchedule, Weekday } from './types.ts'
import { addDays, isLocalDate, isTimeZone, minuteOfDay, weekday } from './timezone.ts'
import { legacyToWeekly } from './legacy.ts'
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
const name = z.string().trim().min(1).max(120)
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const zone = z.string().max(100).refine(isTimeZone, 'Invalid IANA timezone')
const date = z.string().refine(isLocalDate, 'Invalid local date')
const offset = z.union([z.literal(0), z.literal(1)]).default(0)
export const PeriodSchema = z
  .strictObject({
    id,
    name,
    category: z.enum(['active', 'break', 'free']),
    start: time,
    end: time,
    startDayOffset: offset,
    endDayOffset: offset,
    display: z
      .strictObject({ label: name.optional(), showProgress: z.boolean().optional() })
      .optional(),
  })
  .superRefine((p, ctx) => {
    const duration =
      minuteOfDay(p.end) + p.endDayOffset * 1440 - minuteOfDay(p.start) - p.startDayOffset * 1440
    if (duration <= 0 || duration > 1440)
      ctx.addIssue({
        code: 'custom',
        message:
          'Period duration must be positive and at most 24 wall-clock hours; specify day offsets',
        path: ['end'],
      })
  })
const slots = z.array(PeriodSchema).max(24)
export const DayRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rest') }),
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('template'), templateId: id }),
  z.strictObject({ kind: z.literal('slots'), slots }),
])
export function slotsFor(rule: DayRule, schedule: WeeklySchedule): SchedulePeriod[] {
  return rule.kind === 'slots'
    ? rule.slots
    : rule.kind === 'template'
      ? (schedule.templates.find((t) => t.id === rule.templateId)?.slots ?? [])
      : []
}
export function ruleFor(date: string, schedule: WeeklySchedule): DayRule {
  return schedule.exceptions[date]?.rule ?? schedule.weekdays[weekday(date)]
}
const wallRange = (p: SchedulePeriod, shift = 0) => ({
  start: minuteOfDay(p.start) + p.startDayOffset * 1440 + shift,
  end: minuteOfDay(p.end) + p.endDayOffset * 1440 + shift,
})
function overlaps(periods: { start: number; end: number }[]) {
  const sorted = periods.toSorted((a, b) => a.start - b.start)
  return sorted.some((p, i) => i > 0 && p.start < sorted[i - 1]!.end)
}
export const WeeklyScheduleSchema = z
  .strictObject({
    version: z.literal(2),
    timezone: zone,
    templates: z.array(z.strictObject({ id, name, slots })).max(32),
    weekdays: z.strictObject({
      '1': DayRuleSchema,
      '2': DayRuleSchema,
      '3': DayRuleSchema,
      '4': DayRuleSchema,
      '5': DayRuleSchema,
      '6': DayRuleSchema,
      '7': DayRuleSchema,
    }),
    exceptions: z
      .record(date, z.strictObject({ name: name.optional(), rule: DayRuleSchema }))
      .refine((v) => Object.keys(v).length <= 366, 'At most 366 date exceptions')
      .default({}),
    dstDisambiguation: z.enum(['reject', 'earlier', 'later']).default('reject'),
    calendarVersion: z.string().max(100).nullable().default(null),
    override: z
      .strictObject({
        text: z.string().trim().min(1).max(200),
        startAt: z.iso.datetime({ precision: 3 }).optional(),
        endAt: z.iso.datetime({ precision: 3 }).optional(),
      })
      .refine(
        (v) => !v.startAt || !v.endAt || v.startAt < v.endAt,
        'Override end must follow start',
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    const s = value as WeeklySchedule
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message })
    const ids = new Set(s.templates.map((t) => t.id))
    if (ids.size !== s.templates.length) issue(['templates'], 'Duplicate template ID')
    const checkSlots = (items: SchedulePeriod[], path: (string | number)[]) => {
      if (new Set(items.map((p) => p.id)).size !== items.length) issue(path, 'Duplicate period ID')
      if (overlaps(items.map((p) => wallRange(p)))) issue(path, 'Overlapping periods')
    }
    s.templates.forEach((t, i) => checkSlots(t.slots, ['templates', i, 'slots']))
    const checkRule = (r: DayRule, path: (string | number)[]) => {
      if (r.kind === 'template' && !ids.has(r.templateId))
        issue(path, 'Unknown or deleted template')
      if (r.kind === 'slots') checkSlots(r.slots, [...path, 'slots'])
    }
    Object.entries(s.weekdays).forEach(([d, r]) => checkRule(r, ['weekdays', d]))
    Object.entries(s.exceptions).forEach(([d, r]) => checkRule(r.rule, ['exceptions', d, 'rule']))
    for (let i = 1; i <= 7; i++) {
      const today = s.weekdays[String(i) as Weekday],
        tomorrow = s.weekdays[String((i % 7) + 1) as Weekday]
      if (
        overlaps([
          ...slotsFor(today, s).map((p) => wallRange(p)),
          ...slotsFor(tomorrow, s).map((p) => wallRange(p, 1440)),
        ])
      )
        issue(['weekdays', String(i)], 'Periods overlap the next day')
    }
    const pairs = new Set(
      Object.keys(s.exceptions)
        .filter(isLocalDate)
        .flatMap((d) => [addDays(d, -1), d]),
    )
    for (const d of pairs)
      if (
        overlaps([
          ...slotsFor(ruleFor(d, s), s).map((p) => wallRange(p)),
          ...slotsFor(ruleFor(addDays(d, 1), s), s).map((p) => wallRange(p, 1440)),
        ])
      )
        issue(['exceptions', d], 'Date exception overlaps an adjacent day')
  })
export const LegacyScheduleSchema = z
  .strictObject({
    timezone: zone,
    start: time,
    end: time,
    lunchStart: time,
    lunchEnd: time,
    restMode: z.enum(['single', 'double']),
    calendarVersion: z.string().max(100).nullable().default(null),
    calendar: z
      .record(date, z.strictObject({ workday: z.boolean(), name: z.string().max(100).optional() }))
      .refine((v) => Object.keys(v).length <= 366, 'At most 366 date exceptions')
      .optional(),
  })
  .superRefine((value, ctx) => {
    try {
      legacyToWeekly(value as LegacySchedule)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid shift, lunch or adjacent-day boundaries' })
    }
  })
export const ScheduleInputSchema = z.preprocess(
  (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      'version' in value ||
      !('workStart' in value)
    )
      return value
    const { workStart, workEnd, restDayRule, dateExceptions, ...rest } = value as Record<
      string,
      unknown
    >
    if ('start' in rest || 'end' in rest || 'restMode' in rest || 'calendar' in rest) return value
    return {
      ...rest,
      start: workStart,
      end: workEnd,
      restMode: restDayRule,
      ...(dateExceptions === undefined ? {} : { calendar: dateExceptions }),
    }
  },
  z.union([WeeklyScheduleSchema, LegacyScheduleSchema]),
)
