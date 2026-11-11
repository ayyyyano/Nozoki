import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig, ModuleSettingsSchema } from '../../shared/contracts/config.ts'
import {
  presentationSnapshots,
  presentationSources,
  fullCodexPresentation,
} from '../fixtures/presentation.ts'
import { codexRingProjection } from '../../server/services/dashboard-presentation.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { CODEX_RINGS, presentRing } from '../../shared/domain/codex-rings.ts'
import {
  tailnetState,
  primaryTailnetAddress,
  tailnetSummary,
} from '../../shared/domain/tailnet-presentation.ts'
import {
  monitorCode,
  monitorDisplayState,
  monitorLatency,
  monitorName,
  serviceSummary,
} from '../../shared/domain/home-summary.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { source } from '../fixtures/adapters.ts'
import { INTEGRATION_PRESETS } from '../../shared/integration-presets/index.ts'
import { passiveWindows } from '../../server/adapters/codex-observations.ts'

const now = new Date('2026-11-11T01:00:00.000Z'),
  snapshots = () => presentationSnapshots(now)
const codexModule = () => ({
  ...createDefaultConfig().modules.find((m) => m.id === 'codex')!,
  visibility: 'public' as const,
  presentation: fullCodexPresentation(),
})

test('Codex uses verified window lengths, selects one account and never relabels primary as five hours', () => {
  const { codex } = snapshots()
  const module = codexModule()
  const view = codexRingProjection(codex.data, codex, module, +now, true)
  assert.deepEqual(
    view.rings.map((r) => r.id),
    CODEX_RINGS,
  )
  assert.deepEqual(
    view.rings.map((r) => presentRing(r, +now).percent),
    [77, 93, 50, 50],
  )
  const data = codex.data!
  data.quota!.accounts[0].windows[0].remainingPercent = '0'
  data.quota!.accounts[0].windows[1].remainingPercent = '100'
  assert.deepEqual(
    codexRingProjection(data, codex, module, +now, true)
      .rings.slice(0, 2)
      .map((r) => presentRing(r, +now).percent),
    [0, 100],
  )
  for (const a of data.quota!.accounts) for (const w of a.windows) delete w.windowMinutes
  assert.ok(
    codexRingProjection(data, codex, module, +now, true).rings.every((r) => r.state === 'unknown'),
  )
})

test('reset rings use absolute time, expire at the boundary, and reject absent/future/old observations', () => {
  const { codex } = snapshots(),
    module = codexModule()
  const ring = codexRingProjection(codex.data, codex, module, +now, true).rings[2]
  assert.equal(presentRing(ring, +now + 300000).percent, (155 / 300) * 100)
  assert.equal(presentRing(ring, +now + 600000).state, 'stale')
  for (const a of codex.data!.quota!.accounts) {
    for (const w of a.windows) {
      w.resetAt = now.toISOString()
      w.status = 'stale'
    }
  }
  assert.ok(
    codexRingProjection(codex.data, codex, module, +now, true).rings.every(
      (r) => r.state === 'stale',
    ),
  )
  for (const a of codex.data!.quota!.accounts)
    for (const w of a.windows) {
      w.resetAt = null
      w.status = 'ok'
    }
  assert.ok(
    codexRingProjection(codex.data, codex, module, +now, true).rings.every(
      (r) => r.state === 'unknown',
    ),
  )
  const restored = snapshots().codex
  for (const a of restored.data!.quota!.accounts)
    for (const w of a.windows) w.observedAt = new Date(+now + 1000).toISOString()
  assert.ok(
    codexRingProjection(restored.data, restored, module, +now, true).rings.every(
      (r) => r.state === 'unknown',
    ),
  )
})

test('ring policies redact entire values and time intervals independently, without rounding unknown to zero', () => {
  const { codex } = snapshots(),
    module = codexModule()
  module.presentation.codex.guest.weeklyRemaining = 'hidden'
  module.presentation.codex.guest.fiveHourResetProgress = 'masked'
  module.presentation.codex.guest.weeklyResetProgress = 'hidden'
  const view = codexRingProjection(codex.data, codex, module, +now, false)
  assert.deepEqual(view.home, ['fiveHourRemaining'])
  assert.deepEqual(view.rings[1], { id: 'fiveHourResetProgress', state: 'masked' })
  assert.equal(view.rings[0].state, 'remaining')
  assert.ok(!JSON.stringify(view).includes('resetAt'))
  assert.ok(!JSON.stringify(view).includes('93'))
  assert.equal(presentRing(view.rings[0], +now + 45000).percent, null)
  const [first] = codex.data!.quota!.accounts
  codex.data!.quota!.accounts = [first]
  first.windows[0].resetAt = new Date(+now + 30000).toISOString()
  assert.equal(
    codexRingProjection(codex.data, codex, module, +now, false).rings[0].state,
    'unknown',
  )
  for (const status of ['unconfigured', 'unsupported', 'stale', 'error'] as const) {
    const r = codexRingProjection(codex.data, { ...codex, status }, module, +now, true).rings[0]
    assert.equal(r.state, status === 'error' ? 'stale' : status)
  }
})

function state() {
  const config = createDefaultConfig(),
    views = snapshots()
  config.integrations = presentationSources().map((i) => ({
    ...i,
    credentialState: { configured: true, keyVersion: 'fixture', lastUpdatedAt: null },
  }))
  config.quotes = []
  for (const m of config.modules) {
    m.enabled = ['tailscale', 'codex', 'services'].includes(m.id)
    m.visibility = 'public'
    m.sources = {}
    if (m.id in views) m.sources.main = { sourceId: views[m.id].sourceId, subject: 'default' }
    if (m.id === 'codex') m.presentation = fullCodexPresentation()
  }
  return {
    config,
    integrations: config.integrations.map((settings) => ({ settings, envelope: null })),
    snapshots: Object.entries(views).map(([module_id, v]) => ({
      source_id: v.sourceId,
      subject: 'default',
      module_id,
      snapshot_json: JSON.stringify(v),
    })),
  }
}
test('server projection obeys ancestor and field ACLs for every ring and removes raw guest quota', async () => {
  const s = state(),
    module = s.config.modules.find((m) => m.id === 'codex')!
  const data = async () =>
    (await projectGuestDashboard(s, now)).modules.find((m) => m.id === 'codex').snapshot.data
  assert.equal((await data()).quota, undefined)
  module.fields['/quota'] = { enabled: true, visibility: 'admin' }
  assert.ok((await data()).ringView.rings.every((r) => r.state === 'unknown'))
  module.fields = { '/quota/accounts/*/windows/*/resetAt': { enabled: false, visibility: 'admin' } }
  assert.ok((await data()).ringView.rings.every((r) => r.state === 'unknown'))
  module.visibility = 'admin'
  module.guestBehavior = 'hidden'
  assert.ok(!(await projectGuestDashboard(s, now)).modules.some((m) => m.id === 'codex'))
})

test('Tailscale guest masks are constant, fields cannot override private ancestors or alias hidden IPs', async () => {
  const s = state(),
    m = s.config.modules.find((m) => m.id === 'tailscale')!
  const read = async () =>
    (await projectGuestDashboard(s, now)).modules.find((m) => m.id === 'tailscale').snapshot.data
  for (const name of ['full', 'masked', 'hidden'] as const)
    for (const ip of ['full', 'masked', 'hidden'] as const) {
      m.presentation = { tailnetName: name, tailnetIp: ip }
      const data = await read(),
        text = JSON.stringify(data)
      assert.equal(text.includes('SYNTHETIC NODE'), name === 'full')
      assert.equal(text.includes('100.64.'), ip === 'full')
      if (name === 'masked') assert.equal(data.devices[0].name, '名称已遮蔽')
      if (name === 'hidden') assert.equal(data.devices[0].name, undefined)
      if (ip === 'masked') assert.equal(data.devices[0].addressLabel, 'IP 已遮蔽')
      if (ip === 'hidden') assert.equal(data.devices[0].addressLabel, undefined)
    }
  m.presentation = { tailnetName: 'full', tailnetIp: 'full' }
  m.fields = { '/devices/*/addresses': { enabled: false, visibility: 'admin' } }
  const row = s.snapshots.find((v) => v.module_id === 'tailscale')!
  const raw = JSON.parse(row.snapshot_json)
  raw.data.devices[0].name = 'Server 100.64.0.1'
  row.snapshot_json = JSON.stringify(raw)
  assert.ok(!JSON.stringify(await read()).includes('100.64.'))
  m.fields = { '/devices': { enabled: true, visibility: 'admin' } }
  assert.equal((await read()).devices, undefined)
})

test('Tailscale summary budgets, primary address and neutral states are deterministic', () => {
  const nodes = snapshots().tailscale.data!.devices
  for (const n of [0, 1, 2, 3, 8, 10])
    assert.equal(tailnetSummary(nodes.slice(0, n)).length, Math.min(n, 8))
  assert.equal(primaryTailnetAddress(['fd7a::1', '100.64.1.2', '100.64.1.3']), '100.64.1.2')
  assert.equal(primaryTailnetAddress(['fd7a::1']), 'fd7a::1')
  assert.equal(primaryTailnetAddress([]), null)
  const snap = snapshots().tailscale
  assert.deepEqual(
    [true, false, null].map((c) => tailnetState(c, snap, +now)),
    ['up', 'down', 'unknown'],
  )
  assert.equal(tailnetState(false, { ...snap, status: 'stale' }, +now), 'stale')
  assert.equal(tailnetState(false, { ...snap, status: 'error' }, +now), 'unknown')
})

test('optional passive window duration is captured without inferring a window from primary/secondary', () => {
  const windows = passiveWindows(
    {
      observed_at: now.toISOString(),
      signals: {
        'X-Codex-Primary-Used-Percent': '7',
        'X-Codex-Primary-Window-Minutes': '10080',
        'X-Codex-Primary-Reset-At': String(+now / 1000 + 3600),
      },
    },
    {
      source: source('cliproxy-bridge'),
      now,
      transport: {
        get: async () => {
          throw new Error('no fetch')
        },
      },
    },
  )
  assert.equal(windows[0].windowMinutes, 10080)
  assert.equal(windows[0].id, 'primary')
})

test('Services name fallback, latency and stale state preserve IDs and never interpret HTML', async () => {
  assert.equal(monitorName('  主页  ', 'home'), '主页')
  assert.equal(monitorName('  ', 'home'), 'home')
  assert.equal(monitorName(null, 'home'), 'home')
  assert.equal(monitorName('<em>name</em>', 'home'), '<em>name</em>')
  assert.equal(monitorCode('source/id/with-slash'), 'id/with-slash')
  for (const v of [null, -1, NaN, Infinity, '25']) assert.equal(monitorLatency(v), null)
  const s = source('uptimeflare')
  const result = await runAdapter({
    source: s,
    now,
    transport: {
      get: async () => ({
        ageSeconds: null,
        value: {
          up: 3,
          down: 0,
          updatedAt: +now / 1000,
          monitors: {
            a: { up: true, name: '相同名称', latency: 20 },
            b: { up: true, name: '相同名称', latency: -1 },
            c: { up: true, name: ' ' },
          },
        },
      }),
    },
  })
  assert.equal(result.code, undefined)
  assert.deepEqual(
    result.views.services.data.monitors.map((m) => [m.id, m.name, m.latencyMs]),
    [
      ['fixture/a', '相同名称', 20],
      ['fixture/b', '相同名称', null],
      ['fixture/c', 'c', null],
    ],
  )
  const snap = snapshots().services,
    monitor = snap.data!.monitors[2]
  assert.equal(monitorDisplayState(monitor, { ...snap, status: 'stale' }, +now), 'stale')
  assert.equal(monitorDisplayState(monitor, { ...snap, status: 'error' }, +now), 'unknown')
  assert.equal(serviceSummary({ ...snap, status: 'stale' }, +now).down, 0)
})

test('presentation config rejects duplicate slots, unknown policies and settings on unrelated modules', () => {
  const m = codexModule()
  assert.equal(ModuleSettingsSchema.safeParse(m).success, true)
  const duplicate = structuredClone(m)
  duplicate.presentation.codex.slots[1] = duplicate.presentation.codex.slots[0]
  assert.equal(ModuleSettingsSchema.safeParse(duplicate).success, false)
  assert.equal(ModuleSettingsSchema.safeParse({ ...m, id: 'services' }).success, false)
  assert.equal(
    ModuleSettingsSchema.safeParse({
      ...m,
      presentation: {
        codex: {
          ...m.presentation.codex,
          guest: { ...m.presentation.codex.guest, weeklyRemaining: 'unsafe' },
        },
      },
    }).success,
    false,
  )
  assert.equal(
    INTEGRATION_PRESETS.find((p) => p.provider === 'uptime-kuma')?.maturity,
    'experimental',
  )
  assert.equal(INTEGRATION_PRESETS.find((p) => p.provider === 'uptimeflare')?.maturity, undefined)
})
