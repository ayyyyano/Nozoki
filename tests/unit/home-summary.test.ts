import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from '../fixtures/dashboard.ts'
import { createDefaultConfig, ModuleSettingsSchema } from '../../shared/contracts/config.ts'
import {
  deviceSummary,
  monitorHomeIds,
  serviceSummary,
  quoteUpdates,
  monitorStale,
} from '../../shared/domain/home-summary.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'

test('home budgets, explicit empty selection and whole-list health are independent', () => {
  const snap = createFixture('complete').services
  const first = snap.data!.monitors[0]!
  snap.data!.monitors = Array.from({ length: 12 }, (_, i) => ({
    ...first,
    id: 'site/' + i,
    state: i === 11 ? ('down' as const) : ('up' as const),
  }))
  assert.equal(serviceSummary(snap).items.length, 8)
  assert.equal(serviceSummary(snap).down, 1)
  snap.homeItems = ['site/10', 'site/0', 'deleted']
  assert.deepEqual(
    serviceSummary(snap).items.map((m) => m.id),
    ['site/10', 'site/0'],
  )
  snap.homeItems = []
  assert.equal(serviceSummary(snap).items.length, 0)
  assert.equal(
    deviceSummary(Array(7).fill(createFixture('complete').devices.data!.devices[0])).length,
    4,
  )
  assert.equal(deviceSummary([]).length, 0)
  assert.deepEqual(
    monitorHomeIds(snap.data!.monitors, [
      { sourceId: 'other', monitorId: 'site/1' },
      { sourceId: 'site', monitorId: 'deleted' },
      { sourceId: 'site', monitorId: 'site/10' },
    ]),
    ['site/10'],
  )
})
test('selection schema rejects duplicates, over-budget and non-service use', () => {
  const module = createDefaultConfig().modules.find((m) => m.id === 'services')!
  const one = { sourceId: 'site', monitorId: 'site/home' }
  assert.ok(ModuleSettingsSchema.safeParse({ ...module, homeServices: [] }).success)
  assert.equal(
    ModuleSettingsSchema.safeParse({ ...module, homeServices: [one, one] }).success,
    false,
  )
  assert.equal(
    ModuleSettingsSchema.safeParse({ ...module, homeServices: Array(9).fill(one) }).success,
    false,
  )
  assert.equal(
    ModuleSettingsSchema.safeParse({ ...module, id: 'devices', homeServices: [] }).success,
    false,
  )
})
test('quote times merge only when all meanings and delays match; stale checks never fabricate down', () => {
  const items = createFixture('complete').quotes.data!.items
  items.forEach((q) => {
    q.asOf = '2026-11-07T05:00:00.000Z'
    q.delayedMinutes = null
  })
  assert.equal(quoteUpdates(items, null).length, 1)
  items[1]!.asOf = '2026-11-07T05:01:00.000Z'
  assert.equal(quoteUpdates(items, null).length, 2)
  const services = createFixture('complete').services
  const monitor = services.data!.monitors[0]!
  monitor.checkedAt = '2026-11-01T00:00:00.000Z'
  assert.ok(monitorStale(monitor, services, Date.parse('2026-11-09T00:00:00.000Z')))
  assert.equal(monitor.state, 'up')
})
test('home selection follows field ACL and cannot leak private IDs or telemetry through summary or details', async () => {
  const config = createDefaultConfig(),
    module = config.modules.find((m) => m.id === 'services')!
  module.enabled = true
  module.visibility = 'public'
  module.sources = { main: { sourceId: 'tencent', subject: 'default' } }
  module.homeServices = [
    { sourceId: 'tencent', monitorId: 'tencent/private' },
    { sourceId: 'tencent', monitorId: 'tencent/public' },
  ]
  module.fields[fieldPointer(['monitors', '@tencent/private'])] = {
    enabled: false,
    visibility: 'admin',
  }
  const s = createFixture('complete').services
  s.sourceId = 'tencent'
  s.data!.monitors = s.data!.monitors.slice(0, 1).flatMap((m) => [
    { ...m, id: 'tencent/private', name: 'SECRET-MONITOR' },
    { ...m, id: 'tencent/public', name: 'Visible' },
  ])
  const state = {
    config,
    integrations: [],
    snapshots: [
      {
        source_id: 'tencent',
        subject: 'default',
        module_id: 'services',
        snapshot_json: JSON.stringify(s),
      },
    ],
  }
  const dto = await projectGuestDashboard(state)
  const safe = dto.modules.find((m) => m.id === 'services')!
  assert.ok(safe.kind === 'data')
  assert.deepEqual(safe.snapshot.homeItems, ['tencent/public'])
  assert.ok(!JSON.stringify(dto).includes('SECRET-MONITOR'))
  assert.ok(!JSON.stringify(dto).includes('tencent/private'))
  module.homeServices = []
  assert.notEqual((await projectGuestDashboard(state)).configVersion, dto.configVersion)
  module.visibility = 'admin'
  assert.ok(!JSON.stringify(await projectGuestDashboard(state)).includes('tencent/public'))
})
