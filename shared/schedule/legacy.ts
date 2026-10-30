import type { DayRule, LegacySchedule, SchedulePeriod, WeeklySchedule, Weekday } from './types.ts'
import { minuteOfDay } from './timezone.ts'
export function legacyToWeekly(value: LegacySchedule): WeeklySchedule {
  const start = minuteOfDay(value.start)
  let end = minuteOfDay(value.end),
    pauseStart = minuteOfDay(value.lunchStart),
    pauseEnd = minuteOfDay(value.lunchEnd)
  if (start === end) throw new RangeError('A shift must have a nonzero duration')
  if (end < start) end += 1440
  if (pauseStart < start) pauseStart += 1440
  if (pauseEnd < start) pauseEnd += 1440
  if (pauseEnd <= pauseStart) pauseEnd += 1440
  if (pauseStart < start || pauseEnd > end || pauseEnd <= pauseStart)
    throw new RangeError('Lunch must be inside the shift')
  const hhmm = (minute: number) =>
    `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const period = (
    id: string,
    name: string,
    category: SchedulePeriod['category'],
    a: number,
    b: number,
  ): SchedulePeriod => ({
    id,
    name,
    category,
    start: hhmm(a),
    end: hhmm(b),
    startDayOffset: Math.floor(a / 1440) as 0 | 1,
    endDayOffset: Math.floor(b / 1440) as 0 | 1,
  })
  const slots = [
    period('morning', '工作中', 'active', start, pauseStart),
    period('lunch', '午休中', 'break', pauseStart, pauseEnd),
    period('afternoon', '工作中', 'active', pauseEnd, end),
  ].filter((p) => p.start !== p.end || p.startDayOffset !== p.endDayOffset)
  const work: DayRule = { kind: 'template', templateId: 'workday' }
  return {
    version: 2,
    timezone: value.timezone,
    templates: [{ id: 'workday', name: '工作日', slots }],
    weekdays: Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((d) => [
        String(d),
        d === 7 || (d === 6 && value.restMode === 'double') ? { kind: 'rest' } : { ...work },
      ]),
    ) as Record<Weekday, DayRule>,
    exceptions: Object.fromEntries(
      Object.entries(value.calendar ?? {}).map(([date, rule]) => [
        date,
        {
          ...(rule.name === undefined ? {} : { name: rule.name }),
          rule: rule.workday ? { ...work } : { kind: 'rest' },
        },
      ]),
    ),
    dstDisambiguation: 'reject',
    calendarVersion: value.calendarVersion,
  }
}
