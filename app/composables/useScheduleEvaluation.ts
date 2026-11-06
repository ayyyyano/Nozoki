import {
  evaluateSchedule,
  localClock,
  prepareSchedule,
  toLegacySchedule,
  validateSchedule,
} from '../../shared/schedule'
import { activityScheduleView } from '../../shared/domain/schedule-view'
export function useScheduleEvaluation(input: () => unknown, now: () => number) {
  const validation = computed(() => validateSchedule(input()))
  const day = computed(() => {
    try {
      return validation.value.valid
        ? localClock(now(), validation.value.schedule.timezone).date
        : ''
    } catch {
      return ''
    }
  })
  const prepared = computed(() =>
    validation.value.valid && day.value
      ? prepareSchedule(validation.value.schedule, day.value)
      : null,
  )
  const legacy = computed(() =>
    validation.value.valid ? toLegacySchedule(validation.value.schedule) : null,
  )
  const state = computed(() => evaluateSchedule(prepared.value ?? input(), now()))
  const view = computed(() =>
    activityScheduleView(
      state.value,
      now(),
      legacy.value,
      validation.value.valid ? validation.value.schedule.labels : undefined,
    ),
  )
  return { state, view, validation, legacy }
}
