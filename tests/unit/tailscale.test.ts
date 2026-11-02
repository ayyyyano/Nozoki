import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTailscaleDevices,
  tailscaleConnectionLabel,
} from '../../shared/tailscale/index.ts'
import { tailscaleFixture, tailscaleCredentials } from '../fixtures/tailscale.ts'
import { productionTransport } from '../../server/adapters/transport.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import type { StoredState } from '../../server/repositories/config.ts'
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import { collectionPlans } from '../../server/collection/plans.ts'

const source: IntegrationSettings = {
  id: 'tailscale-main',
  provider: 'tailscale',
  protocolVersion: 'tailscale-devices-v2',
  baseUrl: 'https://api.tailscale.com/',
  enabled: true,
  refreshInterval: 300,
  fieldMappings: {},
  capabilities: {},
  credentialState: { configured: true, keyVersion: 'v1', lastUpdatedAt: null },
}
const now = new Date('2026-11-03T00:00:00.000Z')
const token = () =>
  Response.json({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600 })

test('Tailscale normalization keeps connection unknowns, IPv4/IPv6 and missing lastSeen distinct', () => {
  const devices = normalizeTailscaleDevices(tailscaleFixture())
  assert.deepEqual(
    devices.map((d) => d.connectedToControl),
    [true, false, null],
  )
  assert.equal(devices[0]!.lastSeen, null)
  assert.equal(devices[1]!.lastSeen, '2026-11-02T00:00:00.000Z')
  assert.ok(!JSON.stringify(devices).includes('private'))
  for (const key of ['connectedToControl', 'addresses', 'lastSeen'] as const) {
    const fixture: any = tailscaleFixture()
    fixture.devices[0][key] = key === 'addresses' ? ['127.invalid'] : 'false'
    assert.throws(() => normalizeTailscaleDevices(fixture))
  }
  assert.equal(tailscaleConnectionLabel(null, false), '状态未知')
  assert.equal(tailscaleConnectionLabel(true, true), '在线 · 数据过期')
})

test('fixed OAuth transport only exchanges read scope then GETs devices, with no cookies or credential crossover', async () => {
  const requests: { url: string; init: RequestInit }[] = []
  const transport = productionTransport(source, tailscaleCredentials, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init! })
      return requests.length === 1 ? token() : Response.json(tailscaleFixture())
    },
  })
  await assert.rejects(transport.get('api/v2/device/fixture/authorized'), /TARGET_NOT_APPROVED/)
  const result = await runAdapter({ source, now, transport })
  assert.equal(result.status, 'ok')
  assert.equal(result.observedAt, null)
  assert.equal(requests.length, 2)
  assert.equal(requests[0]!.url, 'https://api.tailscale.com/api/v2/oauth/token')
  assert.equal(requests[0]!.init.method, 'POST')
  assert.equal(
    new URLSearchParams(String(requests[0]!.init.body)).get('scope'),
    'devices:core:read',
  )
  assert.equal(requests[1]!.url, 'https://api.tailscale.com/api/v2/tailnet/-/devices')
  assert.equal(requests[1]!.init.method, 'GET')
  assert.equal(new Headers(requests[0]!.init.headers).get('authorization'), null)
  assert.equal(
    new Headers(requests[1]!.init.headers).get('authorization'),
    'Bearer synthetic-access-token',
  )
  assert.ok(!JSON.stringify(requests[1]).includes('synthetic-secret'))
  for (const r of requests) {
    assert.equal(new Headers(r.init.headers).get('cookie'), null)
    assert.equal(r.init.redirect, 'manual')
    assert.equal(r.init.credentials, 'omit')
  }
  assert.equal(snapshotSchema('tailscale').safeParse(result.views.tailscale).success, true)
  assert.ok(!JSON.stringify(result).includes('n-fixture-'))
  await assert.rejects(transport.get('api/v2/tailnet/-/devices'), /REQUEST_BUDGET/)
  for (const baseUrl of ['https://evil.example/', 'https://api.tailscale.com/other/'])
    assert.throws(
      () => productionTransport({ ...source, baseUrl }, tailscaleCredentials),
      /TARGET_NOT_APPROVED/,
    )
})

test('OAuth faults are bounded and never turn devices offline or trigger retries', async () => {
  for (const [reply, code] of [
    [() => new Response(null, { status: 401 }), 'AUTH_REQUIRED'],
    [() => new Response(null, { status: 403 }), 'AUTH_REQUIRED'],
    [() => new Response(null, { status: 429, headers: { 'Retry-After': '600' } }), 'RATE_LIMITED'],
    [
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }),
      'REDIRECT_REJECTED',
    ],
    [() => new Response('<html>error</html>'), 'INVALID_RESPONSE'],
    [
      () => new Response('x'.repeat(131073), { headers: { 'Content-Type': 'application/json' } }),
      'RESPONSE_TOO_LARGE',
    ],
    [
      () =>
        Response.json({ access_token: 'bad\r\nheader', token_type: 'Bearer', expires_in: 3600 }),
      'INVALID_RESPONSE',
    ],
  ] as const) {
    let requests = 0
    const transport = productionTransport(source, tailscaleCredentials, {
      fetch: async () => {
        requests++
        return reply()
      },
    })
    const result = await runAdapter({ source, now, transport })
    assert.equal(result.code, code)
    assert.equal(result.status, 'error')
    assert.deepEqual(result.views, {})
    assert.equal(requests, 1)
  }
  let requests = 0
  assert.throws(
    () =>
      productionTransport(source, '{}', {
        fetch: async () => {
          requests++
          return token()
        },
      }),
    /CREDENTIAL_INVALID/,
  )
  assert.equal(requests, 0)
  const aborted = new AbortController()
  aborted.abort()
  const transport = productionTransport(source, tailscaleCredentials, {
    signal: aborted.signal,
    fetch: async () => {
      requests++
      return token()
    },
  })
  assert.equal((await runAdapter({ source, now, transport })).code, 'ABORTED')
  assert.equal(requests, 0)
})

test('guest projection hides IP on the server, preserves placeholders and respects private device ACLs', async () => {
  const config = createDefaultConfig(),
    module = config.modules.find((m) => m.id === 'tailscale')!
  config.integrations.push(source)
  module.enabled = true
  module.visibility = 'public'
  module.sources.main = { sourceId: source.id, subject: 'default' }
  const state: StoredState = {
    config,
    integrations: [{ settings: source, envelope: null, revision: 'test:1' }],
    snapshots: [],
  }
  const result = await runAdapter({
    source,
    now,
    transport: { get: async () => ({ value: tailscaleFixture(), ageSeconds: null }) },
  })
  state.snapshots.push({
    source_id: source.id,
    subject: 'default',
    module_id: 'tailscale',
    snapshot_json: JSON.stringify(result.views.tailscale),
  })
  const read = () => projectGuestDashboard(state, now)
  const ip = '100.64.1.2'
  for (const policy of ['hidden', 'admin', 'public'] as const) {
    module.ipVisibility = policy
    const dto = await read(),
      text = JSON.stringify(dto)
    assert.equal(text.includes(ip), policy === 'public')
    assert.ok(text.includes('Fixture laptop'))
    const data: any = dto.modules.find((m) => m.id === 'tailscale' && m.kind === 'data')
    assert.equal(data.snapshot.data.devices[0].addressesHidden, policy !== 'public')
  }
  module.ipVisibility = 'admin'
  const version = (await read()).configVersion
  const stored = JSON.parse(state.snapshots[0]!.snapshot_json as string)
  stored.data.devices[0].addresses.push('100.64.50.50')
  state.snapshots[0]!.snapshot_json = JSON.stringify(stored)
  assert.equal((await read()).configVersion, version)
  stored.data.devices[0].name = 'Device at 100.64.1.2'
  state.snapshots[0]!.snapshot_json = JSON.stringify(stored)
  assert.ok(!JSON.stringify(await read()).includes(ip))
  assert.ok(JSON.stringify(await read()).includes('Device at ****'))
  module.fields['/devices/*/addresses'] = { enabled: false, visibility: 'admin' }
  module.ipVisibility = 'public'
  assert.ok(!JSON.stringify(await read()).includes(ip))
  module.fields = {
    ['/devices/@' + result.views.tailscale!.data!.devices[0]!.id]: {
      enabled: true,
      visibility: 'admin',
    },
  }
  assert.ok(!JSON.stringify(await read()).includes('Fixture laptop'))
  module.enabled = false
  assert.ok(!(await read()).modules.some((m) => m.id === 'tailscale'))
  assert.equal(
    collectionPlans(state).some((plan) => plan.source.id === source.id),
    false,
  )
})
