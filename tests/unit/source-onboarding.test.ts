import { dashboardView } from '../../shared/domain/dashboard-view.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig, type IntegrationSettings } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { bindSources, duplicateSourceType } from '../../shared/integration-presets/bindings.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import {
  issueSourceTestProof,
  verifySourceTestProof,
  requiresSourceTest,
} from '../../server/services/source-test-proof.ts'
import { hmacKey } from '../../server/services/auth-crypto.ts'
import type { AuthSession } from '../../server/services/sessions.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
import { collectionPlans } from '../../server/collection/plans.ts'

function source(kind: string, id = kind) {
  const value = createIntegrationDraft(kind, [], 'fixture')
  value.id = id
  value.baseUrl ??= 'https://fixture.example.com/'
  value.enabled = true
  if (value.access?.mode !== 'public') throw new Error()
  value.access.approved = true
  value.access.approvedTarget = sourceTargetKey(value, value.access)
  return value
}
function stored(value: ReturnType<typeof source>): IntegrationSettings {
  const { credential: _credential, connectionProof: _proof, ...settings } = value
  return {
    ...settings,
    credentialState: { configured: false, keyVersion: null, lastUpdatedAt: null },
  }
}
test('automatic bindings preserve IDs, subject, ACL and module switches and select quotes deterministically', () => {
  const config = editableConfig(createDefaultConfig())
  config.integrations.push(
    source('sleepy', 'old-sleepy-123'),
    source('yahoo'),
    source('kuma'),
    source('uptimeflare'),
  )
  const devices = config.modules.find((m) => m.id === 'devices')!
  devices.enabled = false
  devices.sources = { main: { sourceId: 'old-sleepy-123', subject: 'legacy-subject' } }
  const bound = bindSources(config)
  assert.deepEqual(bound.modules.find((m) => m.id === 'devices')!.sources.main, {
    sourceId: 'old-sleepy-123',
    subject: 'legacy-subject',
  })
  assert.equal(bound.modules.find((m) => m.id === 'devices')!.enabled, false)
  assert.equal(bound.modules.find((m) => m.id === 'devices')!.visibility, 'admin')
  assert.deepEqual(
    Object.values(bound.modules.find((m) => m.id === 'services')!.sources).map((s) => s.sourceId),
    ['kuma', 'uptimeflare'],
  )
  assert.ok(bound.quotes.every((q) => q.provider === 'tencent'))
  config.integrations.find((s) => s.id === 'tencent')!.enabled = false
  assert.ok(bindSources(config).quotes.every((q) => q.provider === 'yahoo'))
  config.integrations = []
  const empty = bindSources(config)
  assert.ok(empty.modules.every((m) => !Object.keys(m.sources).length))
  assert.ok(empty.quotes.every((q) => q.provider === null))
  assert.equal(devices.sources.main!.subject, 'legacy-subject')
})
test('singleton enforcement accepts unchanged historical duplicates but refuses adding another instance', () => {
  const first = source('sleepy', 'old-a'),
    second = source('sleepy', 'old-b')
  const old = [stored(first), stored(second)]
  assert.equal(duplicateSourceType([first, second], old), false)
  assert.equal(duplicateSourceType([first], old), false)
  assert.equal(duplicateSourceType([first, source('sleepy', 'new')], old), true)
  assert.equal(duplicateSourceType([source('tencent'), source('yahoo')], []), false)
})
test('successful connection proof is bound to secret, target, fields, session, version and expiry', async () => {
  const session = {
    hash: 'fixture-session',
    settings: {
      fingerprint: 'fixture-identity',
      rateKey: await hmacKey('fixture-only-signing-key'),
    },
  } as AuthSession
  const value = source('cliproxy')
  value.credential = { operation: 'replace', value: 'Synthetic-secret-never-in-token' }
  const now = 1800000000000
  value.connectionProof = await issueSourceTestProof(value, undefined, session, 5, now)
  assert.ok(value.connectionProof)
  assert.ok(!value.connectionProof.includes('Synthetic'))
  assert.equal(await verifySourceTestProof(value, undefined, session, 5, now), true)
  assert.equal(await verifySourceTestProof(value, undefined, session, 6, now), false)
  assert.equal(
    await verifySourceTestProof(value, undefined, { ...session, hash: 'another' }, 5, now),
    false,
  )
  assert.equal(await verifySourceTestProof(value, undefined, session, 5, now + 600001), false)
  for (const edit of [
    (v: typeof value) => {
      v.baseUrl = 'https://other.example.com/'
    },
    (v: typeof value) => {
      v.baseUrl = 'https://fixture.example.com/other/'
    },
    (v: typeof value) => {
      v.credential = { operation: 'replace', value: 'Different-secret' }
    },
    (v: typeof value) => {
      v.fieldMappings = { status_page_slug: 'changed' }
    },
    (v: typeof value) => {
      v.id = 'different'
    },
  ]) {
    const changed = structuredClone(value)
    edit(changed)
    assert.equal(await verifySourceTestProof(changed, undefined, session, 5, now), false)
  }
  assert.equal(requiresSourceTest(value), true)
  const before = stored(value)
  assert.equal(
    requiresSourceTest(
      { ...value, credential: { operation: 'keep' }, refreshInterval: 600 },
      before,
    ),
    false,
  )
  assert.equal(requiresSourceTest(value, before), true)
})
test('both monitor sources create collection plans and merged views preserve stable ACL identifiers', async () => {
  const config = createDefaultConfig()
  const kuma = source('kuma'),
    flare = source('uptimeflare')
  config.integrations = [stored(kuma), stored(flare)]
  const bound = bindSources(config)
  const service = bound.modules.find((m) => m.id === 'services')!
  service.visibility = 'public'
  const now = '2026-11-07T01:00:00.000Z'
  const monitor = (id: string) => ({
    id,
    name: id,
    state: 'up',
    latencyMs: 10,
    checkedAt: now,
    statusPageUrl: null,
    uptimePercent: null,
    capabilities: {},
  })
  const state = {
    config: bound,
    integrations: config.integrations.map((settings) => ({
      settings,
      envelope: null,
      revision: 'fixture:1',
    })),
    snapshots: [kuma, flare].map((s) => ({
      source_id: s.id,
      subject: 'default',
      module_id: 'services',
      snapshot_json: JSON.stringify({
        ...snapshot('ok', { monitors: [monitor(s.id + '/web')] }, s.id),
        observedAt: now,
      }),
    })),
  }
  assert.deepEqual(
    collectionPlans(state).map((p) => p.source.id),
    ['kuma', 'uptimeflare'],
  )
  const read = async () =>
    (await projectGuestDashboard(state)).modules.find((m) => m.id === 'services')!.snapshot!
  const good = await read()
  assert.deepEqual(
    (good.data as { monitors: { id: string }[] }).monitors.map((m) => m.id),
    ['kuma/web', 'uptimeflare/web'],
  )
  state.snapshots.pop()
  const partial = await read()
  assert.equal(partial.status, 'error')
  assert.equal(partial.partialFailures, 1)
  assert.equal((partial.data as { monitors: unknown[] }).monitors.length, 1)
  service.fields = { '/monitors/@kuma~1web/name': { enabled: true, visibility: 'admin' } }
  assert.ok(!JSON.stringify((await read()).data).includes('"name":"kuma/web"'))
  service.visibility = 'admin'
  assert.equal(
    (await projectGuestDashboard(state)).modules.find((m) => m.id === 'services')!.kind,
    'login_required',
  )
})

test('unknown historical protocols preserve existing references without creating new ones', () => {
  const config = editableConfig(createDefaultConfig())
  config.integrations = [
    { ...source('sleepy', 'legacy'), protocolVersion: 'historical-unregistered' },
  ]
  const devices = config.modules.find((m) => m.id === 'devices')!
  devices.sources = { main: { sourceId: 'legacy', subject: 'existing' } }
  const bound = bindSources(config)
  assert.deepEqual(bound.modules.find((m) => m.id === 'devices')!.sources, devices.sources)
  assert.deepEqual(bound.modules.find((m) => m.id === 'codex')!.sources, {})
})

test('safe projection distinguishes absent, pending and disabled sources without exposing their IDs', async () => {
  const config = createDefaultConfig()
  config.integrations = []
  config.modules.find((m) => m.id === 'devices')!.visibility = 'public'
  const read = async () =>
    projectGuestDashboard({ config: bindSources(config), integrations: [], snapshots: [] })
  assert.equal(dashboardView(await read()).devices.sourceConfigured, false)
  const sleepy = stored(source('sleepy', 'private-legacy-id'))
  config.integrations.push(sleepy)
  const pending = await read()
  assert.equal(dashboardView(pending).devices.sourceConfigured, true)
  assert.equal(dashboardView(pending).devices.status, 'unconfigured')
  assert.ok(!JSON.stringify(pending).includes('private-legacy-id'))
  sleepy.enabled = false
  assert.equal(dashboardView(await read()).devices.errorCode, 'SOURCE_DISABLED')
})
