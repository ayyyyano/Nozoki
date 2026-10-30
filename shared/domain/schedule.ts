import {
  evaluateSchedule,
  type LegacySchedule,
  type ScheduleEvaluation,
} from '../schedule/index.ts'
export type SchedulePhase = 'before' | 'working' | 'lunch' | 'after' | 'rest'
export interface ScheduleState {
  phase: SchedulePhase
  label: string
  caption: string
  localDate: string
  clock: string
  targetAt: string | null
  remainingSeconds: number
  progressPercent: number
  restDay: boolean
  timezone: string
  calendarConfigured: boolean
}
/** Compatibility presentation for existing work/lunch callers; calculation is shared/schedule. */
export function legacyScheduleView(
  state: ScheduleEvaluation,
  config: LegacySchedule,
  now: Date | number,
): ScheduleState {
  if (!state.valid) throw new RangeError(state.issues[0]?.message ?? 'Invalid schedule')
  const phase: SchedulePhase = state.current
    ? state.current.category === 'break'
      ? 'lunch'
      : 'working'
    : state.state === 'rest'
      ? 'rest'
      : state.phase === 'before'
        ? 'before'
        : 'after'
  const caption = state.current
    ? phase === 'lunch'
      ? '距离午休结束'
      : state.current.id === 'morning'
        ? '距离午休'
        : '距离下班'
    : !state.nextPeriod
      ? '暂无已知工作日'
      : phase === 'before'
        ? '距离上班'
        : '距离下次上班'
  const periods =
    state.current?.originDate === state.localDate ? state.day!.periods : (state.day?.carryIn ?? [])
  const first = periods[0],
    last = periods.at(-1),
    ms = now instanceof Date ? now.getTime() : now
  const progressPercent =
    state.current && first && last
      ? Math.max(0, Math.min(100, ((ms - first.startMs) / (last.endMs - first.startMs)) * 100))
      : phase === 'after'
        ? 100
        : 0
  const targetAt = state.current
    ? (state.nextChange?.at ?? null)
    : (state.nextPeriod?.startAt ?? null)
  return {
    phase,
    label: {
      before: '尚未上班',
      working: '工作中',
      lunch: '午休中',
      after: '下班啦',
      rest: '今日休息',
    }[phase],
    caption,
    localDate: state.localDate,
    clock: state.clock,
    targetAt,
    remainingSeconds:
      targetAt === null ? 0 : Math.max(0, Math.ceil((Date.parse(targetAt) - ms) / 1000)),
    progressPercent,
    restDay: phase === 'rest',
    timezone: config.timezone,
    calendarConfigured: config.calendarVersion !== null,
  }
}
export function resolveSchedule(now: Date, config: LegacySchedule): ScheduleState {
  const state = evaluateSchedule(config, now)
  if ('version' in config) throw new RangeError('Use evaluateSchedule for custom weekly schedules')
  return legacyScheduleView(state, config, now)
}
export function countdownText(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':')
}
