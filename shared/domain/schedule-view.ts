import type { LegacySchedule, ScheduleEvaluation, ScheduleIssue } from '../schedule/index.ts'
import { legacyScheduleView, countdownText } from './schedule.ts'
export function activityScheduleView(
  state: ScheduleEvaluation,
  now: number,
  legacy: LegacySchedule | null = null,
) {
  const old = legacy && state.valid ? legacyScheduleView(state, legacy, now) : null
  const label =
    state.override?.text ??
    old?.label ??
    state.current?.display?.label ??
    state.current?.name ??
    {
      before: '等待安排',
      between: '自由时间',
      after: '今日安排已结束',
      rest: '今日休息',
      empty: '暂无安排',
      invalid: '日程不可用',
      period: '暂无安排',
    }[state.phase]
  const caption = state.nextChange
    ? (old?.caption ??
      (state.nextChange.kind.startsWith('override')
        ? '距离临时状态切换'
        : state.nextChange.kind === 'day-boundary'
          ? '距离日程切换'
          : state.nextChange.kind === 'start'
            ? `距离 ${state.nextChange.period?.name ?? '下一安排'}`
            : `距离 ${state.nextChange.period?.name ?? '当前时段'} 结束`))
    : '查找范围内暂无下一安排'
  return {
    label,
    caption,
    countdown: old
      ? old.targetAt === null
        ? '—'
        : countdownText(old.remainingSeconds)
      : state.remainingMs === null
        ? '—'
        : countdownText(Math.ceil(state.remainingMs / 1000)),
    progress:
      state.state === 'rest'
        ? null
        : state.current?.display?.showProgress === false
          ? null
          : (old?.progressPercent ?? state.progressPercent),
    tag: state.override
      ? '临时显示'
      : state.current
        ? '计划时段'
        : state.state === 'rest'
          ? '休息日'
          : '自由时间',
    periods: [...(state.day?.carryIn ?? []), ...(state.day?.periods ?? [])].map((p) => ({
      id: p.originDate + ':' + p.id,
      name: p.name,
      text: `${p.startDayOffset ? '次日 ' : ''}${p.start}–${p.endDayOffset ? '次日 ' : ''}${p.end} ${p.name}`,
    })),
    exceptionName: state.day?.exceptionName ?? (state.exception ? '日期例外' : null),
  }
}
export function scheduleIssueText(issue: ScheduleIssue | undefined): string {
  if (!issue) return '请检查日期、时间和时区。'
  const message = /overlap/i.test(issue.message)
    ? '时段发生重叠，请检查当天及相邻日期。'
    : /Unknown or deleted template/.test(issue.message)
      ? '引用的模板不存在，请更换模板。'
      : /duration/.test(issue.message)
        ? '结束时间必须晚于开始时间；跨午夜请将结束日期设为次日。'
        : /Duplicate/.test(issue.message)
          ? '时段或模板 ID 重复。'
          : issue.code === 'NONEXISTENT_LOCAL_TIME'
            ? '该当地时间因时区切换不存在，请调整时段。'
            : issue.code === 'AMBIGUOUS_LOCAL_TIME'
              ? '该当地时间重复，请明确选择较早或较晚一次。'
              : /IANA/.test(issue.message)
                ? '请输入有效的 IANA 时区。'
                : issue.message
  return (issue.date ? issue.date + '：' : '') + message
}
