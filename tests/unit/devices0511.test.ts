import test from 'node:test'
import assert from 'node:assert/strict'
import { source } from '../fixtures/adapters.ts'
import { devicesNow, sleepyDevicesFixture } from '../fixtures/devices0511.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { responseTransport } from '../../server/adapters/transport.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { DataSchemas } from '../../shared/contracts/snapshots.ts'
import type { StoredState } from '../../server/repositories/config.ts'

export async function normalized() {
  const s = source('sleepy')
  return runAdapter({
    source: s,
    now: devicesNow,
    transport: responseTransport(s, async () => Response.json(sleepyDevicesFixture())),
  })
}
test('Sleepy adapter parses mixed optional batteries, full titles and timestamps without asserting heartbeat/charging', async () => {
  const r = await normalized(),
    d = r.views.devices!.data!.devices
  assert.equal(r.status, 'ok')
  assert.equal(r.capabilities.battery!.verified, true)
  assert.deepEqual(
    d.slice(0, 4).map((x) => x.batteryPercent),
    [66, 0, 100, null],
  )
  assert.ok(d.every((x) => x.charging === null && x.heartbeatAt === null))
  assert.ok(d.find((x) => x.id === 'long')!.stateText!.length > 500)
  assert.equal(d[0]!.observedAt, devicesNow.toISOString())
  assert.equal(d[0]!.statusUpdatedAt, new Date(devicesNow.getTime() - 86400000).toISOString())
  assert.equal(DataSchemas.devices.safeParse(r.views.devices!.data).success, true)
  const old = structuredClone(r.views.devices!.data!)
  for (const row of old.devices) {
    delete row.foregroundApp
    delete row.statusUpdatedAt
  }
  assert.equal(DataSchemas.devices.safeParse(old).success, true)
  const s = source('sleepy'),
    stale = sleepyDevicesFixture()
  stale.time -= 1000
  assert.equal(
    (
      await runAdapter({
        source: s,
        now: devicesNow,
        transport: responseTransport(s, async () => Response.json(stale)),
      })
    ).status,
    'stale',
  )
})
test('guest device content aliases use the stricter ACL; public battery cannot expose private titles or items', async () => {
  const r = await normalized(),
    s = source('sleepy'),
    config = createDefaultConfig()
  config.integrations = [s]
  const module = config.modules.find((m) => m.id === 'devices')!
  module.visibility = 'public'
  module.sources = { main: { sourceId: s.id, subject: 'default' } }
  const snap = structuredClone(r.views.devices!)
  snap.data!.devices[0]!.foregroundApp = 'PRIVATE-APPLICATION-0511'
  snap.data!.devices[0]!.stateText = 'PRIVATE-APPLICATION-0511'
  const state: StoredState = {
    config,
    integrations: [],
    snapshots: [
      {
        source_id: s.id,
        subject: 'default',
        module_id: 'devices',
        snapshot_json: JSON.stringify(snap),
      },
    ],
  }
  for (const path of ['/devices/*/foregroundApp', '/devices/*/stateText', 'stateText']) {
    module.fields = {
      [path]: { enabled: true, visibility: 'admin' },
      [fieldPointer(['devices', '@private.a/~'])]: { enabled: true, visibility: 'admin' },
    }
    const dto = await projectGuestDashboard(state, devicesNow),
      json = JSON.stringify(dto)
    assert.ok(!json.includes('PRIVATE-APPLICATION'))
    assert.ok(!json.includes('PRIVATE-DEVICE'))
    const data = (dto.modules.find((m) => m.id === 'devices') as any).snapshot.data
    assert.equal(data.devices[0].batteryPercent, 66)
    assert.ok(!Object.hasOwn(data.devices[0], 'stateText'))
    assert.ok(!Object.hasOwn(data.devices[0], 'foregroundApp'))
  }
  module.fields = { '/devices/*/batteryPercent': { enabled: true, visibility: 'admin' } }
  let dto = await projectGuestDashboard(state, devicesNow)
  assert.ok(JSON.stringify(dto).includes('PRIVATE-APPLICATION'))
  assert.ok(
    !(dto.modules.find((m) => m.id === 'devices') as any).snapshot.data.devices.some((d: any) =>
      Object.hasOwn(d, 'batteryPercent'),
    ),
  )
  module.enabled = false
  assert.ok(
    !(await projectGuestDashboard(state, devicesNow)).modules.some((m) => m.id === 'devices'),
  )
  module.enabled = true
  module.visibility = 'admin'
  module.guestBehavior = 'login_hint'
  dto = await projectGuestDashboard(state, devicesNow)
  assert.equal(dto.modules.find((m) => m.id === 'devices')!.kind, 'login_required')
  assert.ok(!JSON.stringify(dto).includes('PRIVATE-APPLICATION'))
})
