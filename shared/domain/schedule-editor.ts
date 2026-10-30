import type { SchedulePeriod } from '../schedule/types.ts'
export function newSchedulePeriod(id: string, last?: SchedulePeriod): SchedulePeriod {
  let start = last?.end ?? '09:00',
    startDayOffset = last?.endDayOffset ?? 0
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) start = '09:00'
  const [hour, minute] = start.split(':').map(Number)
  let endHour = hour! + 1,
    endDayOffset = startDayOffset
  if (endHour === 24) {
    endHour = 0
    endDayOffset = 1
  }
  if (startDayOffset === 1 && hour === 23) {
    start = '09:00'
    startDayOffset = 0
    endHour = 10
    endDayOffset = 0
  }
  return {
    id,
    name: '新时段',
    category: 'active',
    start,
    end: `${String(endHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    startDayOffset,
    endDayOffset,
  }
}
