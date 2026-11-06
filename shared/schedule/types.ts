export type Weekday = '1' | '2' | '3' | '4' | '5' | '6' | '7'
export type PeriodCategory = 'active' | 'break' | 'free'
export type DstDisambiguation = 'reject' | 'earlier' | 'later'
export type ScheduleLabels = Partial<
  Record<'active' | 'break' | 'free' | 'before' | 'after' | 'rest' | 'empty', string>
>
export interface SchedulePeriod {
  id: string
  name: string
  category: PeriodCategory
  start: string
  end: string
  startDayOffset: 0 | 1
  endDayOffset: 0 | 1
  display?: { label?: string; showProgress?: boolean }
}
export type DayRule =
  | { kind: 'rest' }
  | { kind: 'empty' }
  | { kind: 'template'; templateId: string }
  | { kind: 'slots'; slots: SchedulePeriod[] }
export interface ScheduleTemplate {
  id: string
  name: string
  slots: SchedulePeriod[]
}
export interface ScheduleOverride {
  text: string
  startAt?: string
  endAt?: string
}
export interface WeeklySchedule {
  version: 2
  timezone: string
  templates: ScheduleTemplate[]
  weekdays: Record<Weekday, DayRule>
  exceptions: Record<string, { name?: string; rule: DayRule }>
  dstDisambiguation: DstDisambiguation
  calendarVersion: string | null
  override?: ScheduleOverride
  labels?: ScheduleLabels
}
export interface LegacySchedule {
  timezone: string
  start: string
  end: string
  lunchStart: string
  lunchEnd: string
  restMode: 'single' | 'double'
  calendarVersion: string | null
  calendar?: Record<string, { workday: boolean; name?: string }>
  labels?: ScheduleLabels
}
export type ScheduleInput = LegacySchedule | WeeklySchedule
export interface ScheduleIssue {
  code: string
  path: string
  message: string
  date?: string
}
export interface ResolvedPeriod extends SchedulePeriod {
  originDate: string
  startAt: string
  endAt: string
  startMs: number
  endMs: number
  exception: boolean
}
export interface ResolvedDay {
  date: string
  weekday: Weekday
  restDay: boolean
  exception: boolean
  exceptionName?: string
  periods: ResolvedPeriod[]
  carryIn: ResolvedPeriod[]
}
export interface ScheduleEvent {
  kind: 'start' | 'end' | 'day-boundary' | 'override-start' | 'override-end'
  at: string
  atMs: number
  period: ResolvedPeriod | null
}
export interface PreparedSchedule {
  kind: 'prepared-schedule'
  schedule: WeeklySchedule
  anchorDate: string
  horizonDays: number
  days: ResolvedDay[]
  periods: ResolvedPeriod[]
  events: ScheduleEvent[]
  issues: ScheduleIssue[]
}
export interface ScheduleEvaluation {
  valid: boolean
  state: PeriodCategory | 'rest' | 'invalid'
  phase: 'period' | 'before' | 'between' | 'after' | 'rest' | 'empty' | 'invalid'
  timezone: string
  localDate: string
  clock: string
  day: ResolvedDay | null
  current: ResolvedPeriod | null
  nextChange: ScheduleEvent | null
  nextPeriod: ResolvedPeriod | null
  remainingMs: number | null
  progressPercent: number | null
  exception: boolean
  override: ScheduleOverride | null
  searchExhausted: boolean
  issues: ScheduleIssue[]
}
