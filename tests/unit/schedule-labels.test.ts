import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import {
  evaluateSchedule,
  normalizeSchedule,
  toLegacySchedule,
  validateSchedule,
  type LegacySchedule,
} from '../../shared/schedule/index.ts'
import { activityScheduleView } from '../../shared/domain/schedule-view.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { parseFieldPath } from '../../shared/contracts/field-paths.ts'

const basic = () => createDefaultConfig().site.schedule as LegacySchedule
const view = (schedule: unknown, at: string) => {
  const normalized = normalizeSchedule(schedule)
  return activityScheduleView(
    evaluateSchedule(normalized, at),
    Date.parse(at),
    toLegacySchedule(normalized),
    normalized.labels,
  )
}
test('basic and custom schedules retain labels through lossless mode conversions without changing time results', () => {
  const schedule = basic()
  schedule.labels = {
    active: '专注中',
    break: '午间休息',
    before: '准备中',
    after: '已完成',
    rest: '假日',
  }
  const original = JSON.stringify(schedule),
    weekly = normalizeSchedule(schedule)
  assert.deepEqual(toLegacySchedule(weekly), schedule)
  assert.equal(JSON.stringify(schedule), original)
  for (const [at, expected] of [
    ['2026-10-26T00:00:00Z', '准备中'],
    ['2026-10-26T01:00:00Z', '专注中'],
    ['2026-10-26T04:00:00Z', '午间休息'],
    ['2026-10-26T10:00:00Z', '已完成'],
    ['2026-10-25T01:00:00Z', '假日'],
  ]) {
    assert.equal(view(schedule, at!).label, expected)
    assert.equal(view(weekly, at!).label, expected)
    const old = evaluateSchedule(basic(), at!),
      changed = evaluateSchedule(schedule, at!)
    assert.equal(changed.remainingMs, old.remainingMs)
    assert.equal(changed.progressPercent, old.progressPercent)
    assert.deepEqual(changed.nextChange, old.nextChange)
  }
  weekly.labels!.active = '新活动状态'
  assert.equal(toLegacySchedule(weekly)?.labels?.active, '新活动状态')
})
test('custom period text overrides shared category labels; temporary display remains highest priority', () => {
  const schedule = normalizeSchedule(basic())
  schedule.labels = {
    active: '通用活动',
    free: '自由安排',
    empty: '没有安排',
    before: '即将开始',
    after: '今日完成',
    rest: '假日',
  }
  const slot = schedule.templates[0]!.slots[0]!
  slot.name = '上午课程'
  assert.equal(view(schedule, '2026-10-26T01:00:00Z').label, '通用活动')
  slot.display = { label: '上课中', showProgress: false }
  assert.equal(view(schedule, '2026-10-26T01:00:00Z').label, '上课中')
  assert.equal(view(schedule, '2026-10-26T01:00:00Z').progress, null)
  schedule.override = { text: '临时离开' }
  assert.equal(view(schedule, '2026-10-26T01:00:00Z').label, '临时离开')
  delete schedule.override
  delete slot.display
  delete schedule.labels.active
  assert.equal(view(schedule, '2026-10-26T01:00:00Z').label, '上午课程')
  schedule.weekdays['1'] = {
    kind: 'slots',
    slots: [schedule.templates[0]!.slots[0]!, schedule.templates[0]!.slots[2]!],
  }
  assert.equal(view(schedule, '2026-10-26T04:00:00Z').label, '自由安排')
  assert.equal(view(schedule, '2026-10-26T00:00:00Z').label, '即将开始')
  assert.equal(view(schedule, '2026-10-26T10:00:00Z').label, '今日完成')
  schedule.weekdays['1'] = { kind: 'empty' }
  assert.equal(view(schedule, '2026-10-26T04:00:00Z').label, '没有安排')
})
test('missing labels keep old defaults; blank, oversized and unknown keys fail validation', () => {
  assert.equal(view(basic(), '2026-10-26T01:00:00Z').label, '工作中')
  assert.equal(view(basic(), '2026-10-26T04:00:00Z').label, '午休中')
  for (const schedule of [basic(), normalizeSchedule(basic())]) {
    for (const labels of [{ active: ' ' }, { active: 'x'.repeat(121) }, { unknown: 'unexpected' }])
      assert.equal(validateSchedule({ ...schedule, labels }).valid, false)
    assert.deepEqual(normalizeSchedule({ ...schedule, labels: { active: ' 专注中 ' } }).labels, {
      active: '专注中',
    })
  }
})
test('custom labels also drive countdown captions, timeline and next-period descriptions', () => {
  const schedule = basic()
  schedule.labels = { active: '上课中', break: '课间休息', after: '放学' }
  assert.equal(view(schedule, '2026-10-26T00:00:00Z').caption, '距离 上课中')
  assert.equal(view(schedule, '2026-10-26T01:00:00Z').caption, '距离 课间休息')
  assert.equal(view(schedule, '2026-10-26T04:00:00Z').caption, '距离 课间休息 结束')
  assert.equal(view(schedule, '2026-10-26T06:00:00Z').caption, '距离 放学')
  assert.ok(
    view(schedule, '2026-10-26T01:00:00Z').periods.every(
      (p) => !p.text.includes('工作中') && !p.text.includes('午休中'),
    ),
  )
  const custom = normalizeSchedule(schedule)
  custom.templates[0]!.slots[0]!.display = { label: '数学课' }
  assert.equal(view(custom, '2026-10-26T00:00:00Z').nextPeriodLabel, '数学课')
  assert.equal(view(custom, '2026-10-26T00:00:00Z').caption, '距离 数学课')
})
test('label ACL paths filter private text and keep guest configuration hashes unchanged', async () => {
  assert.ok(parseFieldPath('activity', '/schedule/labels/active'))
  assert.equal(parseFieldPath('activity', '/schedule/labels/unknown'), null)
  for (const custom of [false, true]) {
    const config = createDefaultConfig()
    if (custom) config.site.schedule = normalizeSchedule(config.site.schedule)
    config.site.schedule.labels = { active: 'PRIVATE_STATUS', break: '公开休息' }
    config.modules.find((m) => m.id === 'activity')!.fields = {
      '/schedule/labels/active': { enabled: true, visibility: 'admin' },
    }
    const state = { config, integrations: [], snapshots: [] },
      now = new Date('2026-10-26T01:00:00Z')
    const first = await projectGuestDashboard(state, now)
    assert.ok(!JSON.stringify(first).includes('PRIVATE_STATUS'))
    assert.ok(JSON.stringify(first).includes('公开休息'))
    config.site.schedule.labels.active = 'PRIVATE_CHANGED'
    assert.equal((await projectGuestDashboard(state, now)).configVersion, first.configVersion)
  }
})
