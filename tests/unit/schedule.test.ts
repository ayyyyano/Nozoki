import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSchedule, countdownText } from '../../shared/domain/schedule.ts'
import { DEFAULT_SCHEDULE } from '../../shared/domain/dashboard.ts'

const at = (value: string, options = {}) =>
  resolveSchedule(new Date(value), { ...DEFAULT_SCHEDULE, ...options })
test('weekday before work counts down to 08:30 in Shanghai', () => {
  const value = at('2026-10-23T08:29:59+08:00')
  assert.equal(value.phase, 'before')
  assert.equal(value.remainingSeconds, 1)
  assert.equal(value.targetAt, '2026-10-23T00:30:00.000Z')
})
test('work begins at the exact boundary; morning targets lunch', () => {
  const value = at('2026-10-23T08:30:00+08:00')
  assert.equal(value.phase, 'working')
  assert.equal(value.remainingSeconds, 3 * 3600)
})
test('lunch boundaries are inclusive at start and exclusive at end', () => {
  assert.equal(at('2026-10-23T11:29:59+08:00').remainingSeconds, 1)
  assert.equal(at('2026-10-23T11:30:00+08:00').phase, 'lunch')
  assert.equal(at('2026-10-23T13:29:59+08:00').remainingSeconds, 1)
  const afternoon = at('2026-10-23T13:30:00+08:00')
  assert.equal(afternoon.phase, 'working')
  assert.equal(afternoon.remainingSeconds, 12600)
})
test('end of Friday targets Monday and reaches 100 percent', () => {
  const value = at('2026-10-23T17:00:00+08:00')
  assert.equal(value.phase, 'after')
  assert.equal(value.progressPercent, 100)
  assert.equal(value.targetAt, '2026-10-26T00:30:00.000Z')
})
test('double rest and single rest differ on Saturday; both rest Sunday', () => {
  assert.equal(at('2026-10-24T09:00:00+08:00').phase, 'rest')
  assert.equal(at('2026-10-24T09:00:00+08:00', { restMode: 'single' }).phase, 'working')
  assert.equal(at('2026-10-25T09:00:00+08:00', { restMode: 'single' }).phase, 'rest')
})
test('explicit local-date calendar overrides weekly rest', () => {
  const config = {
    calendar: { '2026-10-24': { workday: true }, '2026-10-23': { workday: false } },
    calendarVersion: 'test-only',
  }
  assert.equal(at('2026-10-24T09:00:00+08:00', config).phase, 'working')
  assert.equal(at('2026-10-23T09:00:00+08:00', config).phase, 'rest')
  assert.equal(at('2026-10-23T09:00:00+08:00', config).calendarConfigured, true)
})
test('overnight shift belongs to its starting workday, including Saturday morning', () => {
  const config = { start: '22:00', end: '06:00', lunchStart: '02:00', lunchEnd: '02:30' }
  assert.equal(at('2026-10-24T01:59:59+08:00', config).remainingSeconds, 1)
  assert.equal(at('2026-10-24T02:00:00+08:00', config).phase, 'lunch')
  assert.equal(at('2026-10-24T02:30:00+08:00', config).remainingSeconds, 12600)
  assert.equal(at('2026-10-24T06:00:00+08:00', config).phase, 'rest')
})
test('lunch can itself cross midnight', () => {
  const value = at('2026-10-23T23:45:00+08:00', {
    start: '22:00',
    end: '06:00',
    lunchStart: '23:30',
    lunchEnd: '00:30',
  })
  assert.equal(value.phase, 'lunch')
  assert.equal(value.remainingSeconds, 2700)
})
test('IANA timezone controls the schedule, not the machine timezone', () => {
  const now = '2026-07-20T13:00:00Z'
  const ny = at(now, { timezone: 'America/New_York' })
  assert.equal(ny.clock, '09:00:00')
  assert.equal(ny.remainingSeconds, 9000)
  assert.equal(ny.targetAt, '2026-07-20T15:30:00.000Z')
  assert.equal(at(now, { timezone: 'Asia/Tokyo' }).clock, '22:00:00')
})
test('winter offsets resolve and DST nonexistent boundaries reject explicitly', () => {
  assert.equal(
    at('2026-01-05T14:00:00Z', { timezone: 'America/New_York' }).targetAt,
    '2026-01-05T16:30:00.000Z',
  )
  assert.throws(
    () =>
      at('2026-03-08T05:00:00Z', {
        timezone: 'America/New_York',
        start: '02:30',
        end: '10:00',
        lunchStart: '06:00',
        lunchEnd: '07:00',
        calendar: { '2026-03-08': { workday: true } },
      }),
    RangeError,
  )
})
test('serializing the server instant preserves the first client result', () => {
  const epoch = new Date('2026-10-23T08:29:59.500+08:00').getTime()
  assert.deepEqual(
    resolveSchedule(new Date(epoch), DEFAULT_SCHEDULE),
    resolveSchedule(new Date(JSON.parse(JSON.stringify(epoch))), DEFAULT_SCHEDULE),
  )
})
test('invalid boundaries, timezone and date are rejected', () => {
  for (const options of [
    { start: '25:00' },
    { start: '17:00' },
    { lunchEnd: '18:00' },
    { timezone: 'Invalid/Zone' },
  ])
    assert.throws(() => at('2026-10-23T01:00:00Z', options), RangeError)
  assert.throws(() => resolveSchedule(new Date('invalid'), DEFAULT_SCHEDULE), RangeError)
})
test('countdown supports days without wrapping hours or negative output', () => {
  assert.equal(countdownText(90061), '25:01:01')
  assert.equal(countdownText(-1), '00:00:00')
})
test('a calendar without a workday in the search window has no countdown target', () => {
  const calendar: Record<string, { workday: boolean }> = {}
  for (let d = 0; d < 15; d++)
    calendar[new Date(Date.UTC(2026, 9, 23 + d)).toISOString().slice(0, 10)] = { workday: false }
  const value = at('2026-10-23T09:00:00+08:00', { calendar })
  assert.equal(value.targetAt, null)
  assert.equal(value.caption, '暂无已知工作日')
})
