import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateSchedule,
  normalizeSchedule,
  resolveScheduleForDate,
  getUpcomingEvents,
  prepareSchedule,
  validateSchedule,
  toLegacySchedule,
  removeScheduleTemplate,
  localInstant,
  type WeeklySchedule,
  type SchedulePeriod,
  type LegacySchedule,
} from '../../shared/schedule/index.ts'
const legacy: LegacySchedule = {
  timezone: 'Asia/Shanghai',
  start: '08:30',
  end: '17:00',
  lunchStart: '11:30',
  lunchEnd: '13:30',
  restMode: 'double',
  calendarVersion: null,
}
const slot = (
  id: string,
  start: string,
  end: string,
  extra: Partial<SchedulePeriod> = {},
): SchedulePeriod => ({
  id,
  name: id,
  category: 'active',
  start,
  end,
  startDayOffset: 0,
  endDayOffset: 0,
  ...extra,
})
const plan = (): WeeklySchedule => ({
  version: 2,
  timezone: 'Asia/Shanghai',
  templates: [],
  weekdays: Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), { kind: 'empty' }]),
  ) as WeeklySchedule['weekdays'],
  exceptions: {},
  dstDisambiguation: 'reject',
  calendarVersion: null,
})
const at = (p: unknown, time: string) => evaluateSchedule(p, time)
test('legacy conversion is pure and round trips days, lunch, exceptions and historical aliases', () => {
  const input = { ...legacy, calendar: { '2026-10-24': { workday: true, name: '补课' } } },
    copy = JSON.stringify(input)
  const normalized = normalizeSchedule(input)
  assert.equal(JSON.stringify(input), copy)
  assert.deepEqual(toLegacySchedule(normalized), input)
  assert.equal(normalized.templates[0]!.slots.length, 3)
  assert.equal(at(normalized, '2026-10-24T04:00:00Z').state, 'break')
  const { start, end, restMode, calendar, ...rest } = input
  assert.deepEqual(
    normalizeSchedule({
      ...rest,
      workStart: start,
      workEnd: end,
      restDayRule: restMode,
      dateExceptions: calendar,
    }),
    normalized,
  )
})
test('legacy single and double weekends are represented by weekly rules', () => {
  assert.equal(at(legacy, '2026-10-24T01:00:00Z').state, 'rest')
  assert.equal(at({ ...legacy, restMode: 'single' }, '2026-10-24T01:00:00Z').state, 'active')
  assert.equal(at({ ...legacy, restMode: 'single' }, '2026-10-25T01:00:00Z').state, 'rest')
})
test('seven independent days, multiple periods, sorting and a gap retain their meaning', () => {
  const p = plan()
  for (let d = 1; d <= 7; d++)
    p.weekdays[String(d) as keyof typeof p.weekdays] = {
      kind: 'slots',
      slots: [slot('evening-' + d, '18:30', '20:40'), slot('morning-' + d, '08:00', '10:00')],
    }
  assert.equal(normalizeSchedule(p).weekdays['1'].kind, 'slots')
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.UTC(2026, 9, 26 + d)).toISOString().slice(0, 10)
    assert.equal(at(p, date + 'T01:00:00Z').current?.id, 'morning-' + (d + 1))
  }
  const between = at(p, '2026-10-26T08:00:00Z')
  assert.equal(between.phase, 'between')
  assert.equal(between.nextPeriod?.id, 'evening-1')
  assert.equal(between.remainingMs, 2.5 * 3600000)
  assert.equal(toLegacySchedule(p), null)
})
test('half-open intervals switch exactly at an adjacent boundary and use absolute progress', () => {
  const p = plan()
  p.weekdays['1'] = {
    kind: 'slots',
    slots: [
      slot('am', '08:00', '11:30'),
      slot('lunch', '11:30', '13:30', { category: 'break' }),
      slot('pm', '13:30', '17:00'),
    ],
  }
  assert.equal(at(p, '2026-10-26T03:29:59Z').current?.id, 'am')
  assert.equal(at(p, '2026-10-26T03:30:00Z').current?.id, 'lunch')
  assert.equal(at(p, '2026-10-26T05:30:00Z').current?.id, 'pm')
  assert.equal(at(p, '2026-10-26T04:30:00Z').progressPercent, 50)
  assert.equal(at(p, '2026-10-26T09:00:00Z').current, null)
})
test('overlap, duplicate IDs, implicit midnight and empty-duration periods are rejected', () => {
  for (const periods of [
    [slot('a', '08:00', '10:00'), slot('b', '09:00', '11:00')],
    [slot('a', '08:00', '09:00'), slot('a', '09:00', '10:00')],
    [slot('a', '22:00', '02:00')],
    [slot('a', '08:00', '08:00')],
  ]) {
    const p = plan()
    p.weekdays['1'] = { kind: 'slots', slots: periods }
    assert.equal(validateSchedule(p).valid, false)
  }
})
test('explicit overnight periods survive midnight and a weekly rest day', () => {
  const p = plan()
  p.weekdays['5'] = { kind: 'slots', slots: [slot('night', '22:00', '02:00', { endDayOffset: 1 })] }
  p.weekdays['6'] = { kind: 'rest' }
  const value = at(p, '2026-10-23T17:00:00Z')
  assert.equal(value.current?.id, 'night')
  assert.equal(value.current?.originDate, '2026-10-23')
  assert.equal(value.remainingMs, 3600000)
  assert.equal(resolveScheduleForDate(p, '2026-10-24').carryIn[0]?.id, 'night')
  assert.equal(at(p, '2026-10-23T18:00:00Z').state, 'rest')
})
test('cross-day conflicts including Sunday/Monday and date overrides are rejected', () => {
  const p = plan()
  p.weekdays['7'] = { kind: 'slots', slots: [slot('night', '22:00', '02:00', { endDayOffset: 1 })] }
  p.weekdays['1'] = { kind: 'slots', slots: [slot('early', '01:00', '03:00')] }
  assert.equal(validateSchedule(p).valid, false)
  p.weekdays['1'] = { kind: 'empty' }
  p.exceptions['2026-10-26'] = { rule: { kind: 'slots', slots: [slot('early', '01:00', '03:00')] } }
  assert.equal(validateSchedule(p).valid, false)
})
test('templates are reusable; deleting a referenced template fails validation', () => {
  const p = plan()
  p.templates = [{ id: 'classes', name: '课程', slots: [slot('class', '18:00', '20:00')] }]
  p.weekdays['1'] = { kind: 'template', templateId: 'classes' }
  p.weekdays['3'] = { kind: 'template', templateId: 'classes' }
  assert.equal(at(p, '2026-10-26T11:00:00Z').current?.id, 'class')
  assert.equal(at(p, '2026-10-28T11:00:00Z').current?.id, 'class')
  p.templates = []
  assert.equal(validateSchedule(p).valid, false)
})
test('referenced template removal refuses data loss and an unreferenced removal is immutable', () => {
  const p = plan()
  p.templates = [{ id: 'test', name: '模板', slots: [] }]
  p.weekdays['1'] = { kind: 'template', templateId: 'test' }
  assert.throws(() => removeScheduleTemplate(p, 'test'), /TEMPLATE_IN_USE/)
  p.weekdays['1'] = { kind: 'empty' }
  assert.equal(removeScheduleTemplate(p, 'test').templates.length, 0)
  assert.equal(p.templates.length, 1)
})
test('a midnight rest-state change is distinct from the next effective arrangement', () => {
  const p = normalizeSchedule(legacy),
    result = at(p, '2026-10-23T10:00:00Z')
  assert.equal(result.nextChange?.kind, 'day-boundary')
  assert.equal(result.nextChange?.at, '2026-10-23T16:00:00.000Z')
  assert.equal(result.nextPeriod?.startAt, '2026-10-26T00:30:00.000Z')
})
test('local date exceptions replace weekly rules and support rest, template and independent slots', () => {
  const p = normalizeSchedule(legacy)
  p.exceptions['2026-10-26'] = { name: '休息', rule: { kind: 'rest' } }
  p.exceptions['2026-10-25'] = { rule: { kind: 'template', templateId: 'workday' } }
  p.exceptions['2026-10-27'] = { rule: { kind: 'slots', slots: [slot('late', '18:00', '21:00')] } }
  assert.equal(at(p, '2026-10-26T01:00:00Z').state, 'rest')
  assert.equal(at(p, '2026-10-25T01:00:00Z').state, 'active')
  assert.equal(at(p, '2026-10-27T11:00:00Z').current?.id, 'late')
  assert.equal(at(p, '2026-10-27T11:00:00Z').exception, true)
})
test('multiple rest days and week rollover find the next actual period, not a fixed workday', () => {
  const p = plan()
  p.weekdays['2'] = { kind: 'slots', slots: [slot('tue', '18:00', '19:00')] }
  const value = at(p, '2026-10-30T04:00:00Z')
  assert.equal(value.nextPeriod?.startAt, '2026-11-03T10:00:00.000Z')
  const events = getUpcomingEvents(p, '2026-10-30T04:00:00Z', { limit: 2 })
  assert.equal(events.events[0]?.period?.id, 'tue')
  assert.equal(events.events.length, 2)
})
test('empty schedules, invalid input, invalid current time and bounded search have structured results', () => {
  const empty = at(plan(), '2026-10-26T00:00:00Z')
  assert.equal(empty.valid, true)
  assert.equal(empty.phase, 'empty')
  assert.equal(empty.remainingMs, null)
  assert.equal(empty.progressPercent, null)
  assert.equal(empty.searchExhausted, true)
  for (const input of [
    null,
    {},
    { ...legacy, start: '99:00' },
    { ...plan(), timezone: 'Invalid/Zone' },
  ])
    assert.equal(at(input, '2026-10-26T00:00:00Z').valid, false)
  assert.equal(at(legacy, 'invalid').valid, false)
  const p = plan()
  p.exceptions['2027-01-01'] = {
    rule: { kind: 'slots', slots: [slot('future', '12:00', '13:00')] },
  }
  assert.equal(evaluateSchedule(p, '2026-10-26T00:00:00Z', { horizonDays: 2 }).nextPeriod, null)
})
test('DST gaps and repeated times fail closed; explicit earlier/later select different instants', () => {
  const p = plan()
  p.timezone = 'America/New_York'
  p.exceptions['2026-03-08'] = { rule: { kind: 'slots', slots: [slot('gap', '02:30', '04:00')] } }
  const gap = at(p, '2026-03-08T05:00:00Z')
  assert.equal(gap.valid, false)
  assert.ok(gap.issues.some((i) => i.code === 'NONEXISTENT_LOCAL_TIME'))
  p.exceptions = {
    '2026-11-01': { rule: { kind: 'slots', slots: [slot('repeat', '01:30', '02:30')] } },
  }
  assert.equal(at(p, '2026-11-01T04:00:00Z').valid, false)
  p.dstDisambiguation = 'earlier'
  const early = at(p, '2026-11-01T06:30:00Z')
  assert.equal(early.current?.startAt, '2026-11-01T05:30:00.000Z')
  assert.equal(early.progressPercent, 50)
  p.dstDisambiguation = 'later'
  assert.equal(at(p, '2026-11-01T06:30:00Z').current?.startAt, '2026-11-01T06:30:00.000Z')
})
test('non-Shanghai zones, half-hour DST and non-hour offsets are supported', () => {
  assert.equal(
    localInstant('2026-10-26', '08:30', 'Asia/Kathmandu'),
    Date.parse('2026-10-26T02:45:00Z'),
  )
  assert.throws(() => localInstant('2026-10-04', '02:15', 'Australia/Lord_Howe'), /NONEXISTENT/)
  const earlier = localInstant('2026-04-05', '01:45', 'Australia/Lord_Howe', 'earlier'),
    later = localInstant('2026-04-05', '01:45', 'Australia/Lord_Howe', 'later')
  assert.equal(later - earlier, 1800000)
  const p = normalizeSchedule(legacy)
  p.timezone = 'America/New_York'
  assert.equal(at(p, '2026-07-20T13:00:00Z').clock, '09:00:00')
})
test('temporary display overrides expire without changing underlying weekly periods', () => {
  const p = normalizeSchedule(legacy),
    before = JSON.stringify(p.weekdays)
  p.override = {
    text: '临时自习',
    startAt: '2026-10-26T01:00:00.000Z',
    endAt: '2026-10-26T02:00:00.000Z',
  }
  assert.equal(at(p, '2026-10-26T00:59:59Z').override, null)
  assert.equal(at(p, '2026-10-26T01:00:00Z').override?.text, '临时自习')
  assert.equal(at(p, '2026-10-26T02:00:00Z').override, null)
  assert.equal(JSON.stringify(p.weekdays), before)
})
test('prepared timelines use the same pure evaluation and reject an unrelated anchor date', () => {
  const prepared = prepareSchedule(legacy, '2026-10-26'),
    now = '2026-10-26T04:30:00Z'
  assert.deepEqual(evaluateSchedule(prepared, now), evaluateSchedule(legacy, now))
  assert.equal(evaluateSchedule(prepared, '2026-10-27T04:30:00Z').valid, false)
  const input = JSON.stringify(prepared)
  for (let i = 0; i < 100; i++) evaluateSchedule(prepared, Date.parse(now) + i * 1000)
  assert.equal(JSON.stringify(prepared), input)
})
