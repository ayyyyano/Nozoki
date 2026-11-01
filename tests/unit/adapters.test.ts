import test from 'node:test'
import assert from 'node:assert/strict'
import {
  responseTransport,
  productionTransport,
  serviceEndpoint,
  assertProductionTarget,
  RESPONSE_LIMIT,
  endpointCatalog,
} from '../../server/adapters/transport.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { credentialKeys } from '../../server/services/credential-keys.ts'
import { encryptCredential, decryptCredential } from '../../server/services/credentials.ts'
import { online } from '../../server/adapters/sleepy.ts'
import { now, seconds, source, replies } from '../fixtures/adapters.ts'
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
const providers: IntegrationSettings['provider'][] = [
  'deepseek',
  'sleepy',
  'cliproxy-bridge',
  'uptime-kuma',
  'uptimeflare',
]
const json = (v: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(v), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
const perform = (
  provider: IntegrationSettings['provider'],
  map = replies(provider),
  mode: 'read' | 'probe' = 'read',
) =>
  runAdapter(
    {
      source: source(provider),
      now,
      transport: responseTransport(source(provider), async (endpoint) => json(map[endpoint])),
    },
    mode,
  )
test('all pinned protocol fixtures validate into existing strict DTOs; unknown extensions are stripped', async () => {
  for (const p of providers) {
    const map = replies(p)
    for (const v of Object.values(map))
      if (v && typeof v === 'object') Object.assign(v, { unknownPrivate: 'DO_NOT_PUBLISH' })
    const r = await perform(p, map)
    assert.equal(r.code, undefined, p)
    assert.equal(r.status, p === 'cliproxy-bridge' ? 'unsupported' : 'ok')
    assert.ok(!JSON.stringify(r.views).includes('DO_NOT_PUBLISH'))
  }
  const empty: Record<string, any> = {}
  for (const p of providers) empty[p] = replies(p)
  empty.deepseek['user/balance'].balance_infos = []
  empty.sleepy['api/status/query'].device = {}
  empty['uptime-kuma']['api/status-page/public'].publicGroupList = []
  empty.uptimeflare['api/data'].monitors = {}
  empty['cliproxy-bridge']['v8/management/config/observability/usage/usage-statistics-enabled'] =
    false
  for (const p of providers) {
    const r = await perform(p, empty[p])
    assert.equal(r.code, undefined)
    assert.equal(r.items, 0)
  }
})
test('DeepSeek preserves exact multi-currency amounts, zero and unknown observed time; no fabricated spend', async () => {
  const r = await perform('deepseek'),
    d = r.views.deepseek!.data!
  assert.equal(d.balances[0]!.total, '110.000000000000000001')
  assert.equal(d.balances[1]!.total, '0.00')
  assert.equal(r.observedAt, null)
  assert.deepEqual(d.spend, [])
  assert.equal(d.capabilities.spend.supported, false)
  for (const invalid of [110, 'NaN', '1e20', '01.0']) {
    const map = replies('deepseek') as any
    map['user/balance'].balance_infos[0].total_balance = invalid
    assert.equal((await perform('deepseek', map)).code, 'INVALID_RESPONSE')
  }
  const map = replies('deepseek') as any
  map['user/balance'].is_available = false
  assert.equal((await perform('deepseek', map)).status, 'ok')
})
test('Sleepy false string, missing online, last-change time and unsupported battery stay distinct', async () => {
  assert.equal(online('false'), false)
  assert.equal(online('true'), true)
  assert.equal(online('FALSE'), null)
  const r = await perform('sleepy'),
    d = r.views.devices!.data!.devices
  assert.equal(d[0]!.online, false)
  assert.equal(d[1]!.online, null)
  assert.equal(d[0]!.batteryPercent, null)
  assert.equal(d[0]!.charging, null)
  assert.equal(d[0]!.heartbeatAt, null)
  assert.equal(r.status, 'ok')
  assert.equal(r.capabilities.heartbeat!.supported, false)
  const map = replies('sleepy') as any
  map['api/status/query'].time = seconds - 1000
  assert.equal((await perform('sleepy', map)).status, 'stale')
  map['api/status/query'].success = false
  assert.equal((await perform('sleepy', map)).code, 'INVALID_RESPONSE')
  assert.equal(
    (await perform('sleepy', replies('sleepy'), 'probe')).capabilities.devices!.verified,
    false,
  )
})
test('Kuma public metadata is a one-request probe; heartbeat 0/down, maintenance and pending are distinct', async () => {
  const r = await perform('uptime-kuma'),
    m = r.views.services!.data!.monitors
  assert.equal(m[0]!.state, 'up')
  assert.equal(m[0]!.latencyMs, 0)
  assert.equal(m[1]!.state, 'pending')
  assert.equal(m[1]!.checkedAt, null)
  assert.equal(m[0]!.uptimePercent, '99.98')
  assert.equal(r.observedAt, '2026-10-27T05:59:30.000Z')
  for (const [status, expected] of [
    [0, 'down'],
    [2, 'pending'],
    [3, 'maintenance'],
  ] as const) {
    const map = replies('uptime-kuma') as any
    map['api/status-page/heartbeat/public'].heartbeatList['1'][0].status = status
    assert.equal(
      (await perform('uptime-kuma', map)).views.services!.data!.monitors[0]!.state,
      expected,
    )
  }
  const map = replies('uptime-kuma') as any
  map['api/status-page/heartbeat/public'].heartbeatList['1'][0].time = '2026-02-30 05:59:30.000'
  assert.equal((await perform('uptime-kuma', map)).code, 'INVALID_RESPONSE')
  const future = replies('uptime-kuma') as any
  future['api/status-page/heartbeat/public'].heartbeatList['1'][0].time = '2026-10-26 05:00:00.000'
  future['api/status-page/heartbeat/public'].heartbeatList['2'] = [
    { status: 1, time: '2026-10-28 06:00:00.000' },
  ]
  assert.equal((await perform('uptime-kuma', future)).code, 'INVALID_RESPONSE')
  assert.equal(
    (await perform('uptime-kuma', replies('uptime-kuma'), 'probe')).views.services,
    undefined,
  )
})
test('UptimeFlare uses each monitor boolean, never aggregate counts; old source time is stale', async () => {
  const map = replies('uptimeflare') as any
  map['api/data'].up = 999
  const r = await perform('uptimeflare', map)
  assert.deepEqual(
    r.views.services!.data!.monitors.map((m) => m.state),
    ['up', 'down'],
  )
  assert.ok(!JSON.stringify(r.views).includes('<script>'))
  map['api/data'].updatedAt = seconds - 10000
  assert.equal((await perform('uptimeflare', map)).status, 'stale')
  map['api/data'].updatedAt = seconds + 10000
  assert.equal((await perform('uptimeflare', map)).code, 'INVALID_RESPONSE')
})
test('CLIProxy v8 only reads the config flag; no queue, account, quota or fabricated token use', async () => {
  const r = await perform('cliproxy-bridge')
  assert.equal(r.status, 'unsupported')
  assert.equal(r.views.codex!.data!.usage, null)
  assert.equal(r.capabilities.quota!.supported, false)
  assert.deepEqual(endpointCatalog(source('cliproxy-bridge')), [
    'v8/management/config/observability/usage/usage-statistics-enabled',
  ])
  for (const e of [
    'v8/management/observability/usage/queue',
    'v0/management/usage-queue',
    'v8/management/auth-files',
    'v1/chat/completions',
  ])
    await assert.rejects(
      () => responseTransport(source('cliproxy-bridge'), async () => json({})).get(e),
      { code: 'TARGET_NOT_APPROVED' },
    )
})
test('each implemented source rejects missing fields, wrong types, null, unsupported versions and disabled input', async () => {
  for (const p of providers) {
    for (const value of [{}, null, [], { success: false }, 'secret', 12]) {
      const map = Object.fromEntries(Object.keys(replies(p)).map((k) => [k, value]))
      assert.equal((await perform(p, map)).code, 'INVALID_RESPONSE', p)
    }
    const s = source(p)
    s.protocolVersion = 'unverified-latest'
    let calls = 0
    const transport = {
      get: async () => {
        calls++
        return { value: {}, ageSeconds: null }
      },
    }
    assert.equal((await runAdapter({ source: s, now, transport })).status, 'unsupported')
    s.enabled = false
    assert.equal((await runAdapter({ source: s, now, transport })).status, 'unconfigured')
    assert.equal(calls, 0)
  }
  assert.equal((await perform('deepseek-spend')).status, 'unsupported')
  assert.equal((await perform('quotes-custom')).status, 'unconfigured')
})
test('HTTP fault matrix applies to every source; upstream failure never becomes down/offline', async () => {
  for (const p of providers)
    for (const [status, code] of [
      [401, 'AUTH_REQUIRED'],
      [403, 'AUTH_REQUIRED'],
      [404, 'NOT_FOUND'],
      [429, 'RATE_LIMITED'],
      [500, 'UPSTREAM_UNAVAILABLE'],
      [503, 'UPSTREAM_UNAVAILABLE'],
      [302, 'REDIRECT_REJECTED'],
    ] as const) {
      const s = source(p)
      const r = await runAdapter({
        source: s,
        now,
        transport: responseTransport(s, async () =>
          json(
            { private: 'not returned' },
            { status, headers: { 'Retry-After': '120', Location: 'https://evil.invalid' } },
          ),
        ),
      })
      assert.equal(r.status, 'error')
      assert.equal(r.code, code, p + status)
      assert.deepEqual(r.views, {})
      if (status === 429) assert.equal(r.retryAfterSeconds, 120)
      assert.ok(!JSON.stringify(r).includes('private'))
    }
})
test('bounded transport rejects invalid JSON/type/UTF8, oversized declared/stream bytes and complex documents before parsing', async () => {
  const cases = [
    new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } }),
    json({}, { headers: { 'Content-Length': String(RESPONSE_LIMIT + 1) } }),
    new Response(' '.repeat(RESPONSE_LIMIT + 1), {
      headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
    }),
    new Response('['.repeat(18) + '0' + ']'.repeat(18), {
      headers: { 'Content-Type': 'application/json' },
    }),
    json(Array(11000).fill(0)),
  ]
  for (const response of cases)
    await assert.rejects(
      () => responseTransport(source('deepseek'), async () => response).get('user/balance'),
      (e) => ['INVALID_RESPONSE', 'RESPONSE_TOO_LARGE'].includes((e as any).code),
    )
})
test('timeout, cancellation, streaming stall, network failure and request budgets cleanly terminate', async () => {
  await assert.rejects(
    () =>
      responseTransport(source('deepseek'), async () => new Promise(() => {}), {
        timeoutMs: 10,
      }).get('user/balance'),
    { code: 'TIMEOUT' },
  )
  let cancelled = false
  await assert.rejects(
    () =>
      responseTransport(
        source('deepseek'),
        async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true
              },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        { timeoutMs: 10 },
      ).get('user/balance'),
    { code: 'TIMEOUT' },
  )
  assert.ok(cancelled)
  const ctrl = new AbortController()
  ctrl.abort()
  let preAbortedCalls = 0
  await assert.rejects(
    () =>
      responseTransport(
        source('deepseek'),
        async () => {
          preAbortedCalls++
          return json({})
        },
        { signal: ctrl.signal },
      ).get('user/balance'),
    { code: 'ABORTED' },
  )
  assert.equal(preAbortedCalls, 0)
  await assert.rejects(
    () =>
      responseTransport(source('deepseek'), async () => {
        throw new Error('PRIVATE_DNS_ERROR')
      }).get('user/balance'),
    { code: 'UPSTREAM_UNAVAILABLE' },
  )
  const t = responseTransport(source('deepseek'), async () => json({}))
  await t.get('user/balance')
  await t.get('user/balance')
  await assert.rejects(() => t.get('user/balance'), { code: 'REQUEST_BUDGET' })
  let release!: () => void
  const slow = responseTransport(source('deepseek'), async () => {
    await new Promise<void>((r) => (release = r))
    return json({})
  })
  const pending = slow.get('user/balance')
  await assert.rejects(() => slow.get('user/balance'), { code: 'REQUEST_BUDGET' })
  release()
  await pending
})
test('production destination is fixed: SSRF, arbitrary DNS, IDNA, numeric/mapped IP, redirect/path/root tricks fail closed', async () => {
  const s = source('deepseek')
  for (const root of [
    'https://localhost/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://10.0.0.1/',
    'https://172.16.1.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/',
    'https://2130706433/',
    'https://0177.0.0.1/',
    'https://0x7f000001/',
    'https://[::ffff:127.0.0.1]/',
    'https://example.invalid/',
    'https://rebind.example/',
    'https://例子.测试/',
    'https://api.deepseek.com.evil.invalid/',
    'https://api.deepseek.com/private/',
    'https://api.deepseek.com/?private=1',
    'https://user:pass@api.deepseek.com/',
    'https://api.deepseek.com/#x',
    'http://api.deepseek.com/',
    'https://api.deepseek.com/a/../',
    'https://api.deepseek.com/%2e%2e/',
    'https://api.deepseek.com/%2F/',
    'https://api.deepseek.com\\@evil.invalid/',
  ])
    assert.throws(
      () => assertProductionTarget({ ...s, baseUrl: root }),
      { code: 'TARGET_NOT_APPROVED' },
      root,
    )
  for (const endpoint of [
    '../user/balance',
    '/user/balance',
    '%2e%2e/balance',
    'user%2Fbalance',
    'https://evil.invalid/',
    'user/balance?key=x',
  ])
    assert.throws(() => serviceEndpoint('https://api.deepseek.com/', endpoint), {
      code: 'TARGET_NOT_APPROVED',
    })
  await assert.rejects(() => responseTransport(s, async () => json({})).get('USER/balance'), {
    code: 'TARGET_NOT_APPROVED',
  })
  assert.doesNotThrow(() =>
    assertProductionTarget({ ...s, baseUrl: 'https://API.DEEPSEEK.COM:443/' }),
  )
  assert.throws(
    () => productionTransport({ ...s, baseUrl: 'https://api.deepseek.com/' }, undefined),
    { code: 'AUTH_REQUIRED' },
  )
  assert.throws(
    () => productionTransport({ ...s, baseUrl: 'https://api.deepseek.com/' }, 'x\r\ny'),
    { code: 'CREDENTIAL_INVALID' },
  )
})
test('versioned key reader retains AES-GCM v1, rejects missing/conflicting versions and tampered AAD', async () => {
  const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    a = key(),
    b = key()
  const original = await credentialKeys({
      INTEGRATION_ENCRYPTION_KEY: a,
      INTEGRATION_KEY_VERSION: 'v1',
    }),
    envelope = await encryptCredential(
      'a',
      'deepseek',
      'SYNTHETIC-ONLY',
      original,
      now.toISOString(),
    )
  const retained = await credentialKeys({
    INTEGRATION_ENCRYPTION_KEY: b,
    INTEGRATION_KEY_VERSION: 'v2',
    INTEGRATION_DECRYPTION_KEYS: JSON.stringify({ v1: a }),
  })
  assert.equal(await decryptCredential('a', 'deepseek', envelope, retained), 'SYNTHETIC-ONLY')
  for (const [id, p, v] of [
    ['b', 'deepseek', envelope],
    ['a', 'sleepy', envelope],
    ['a', 'deepseek', { ...envelope, keyVersion: 'v2' }],
  ] as const)
    await assert.rejects(() => decryptCredential(id, p, v, retained))
  await assert.rejects(() => credentialKeys({}))
  await assert.rejects(() =>
    credentialKeys({
      INTEGRATION_ENCRYPTION_KEY: b,
      INTEGRATION_KEY_VERSION: 'v1',
      INTEGRATION_DECRYPTION_KEYS: JSON.stringify({ v1: a }),
    }),
  )
  await assert.rejects(() =>
    decryptCredential('a', 'deepseek', envelope, awaitedRing(retained, 'v2')),
  )
})
function awaitedRing(ring: Awaited<ReturnType<typeof credentialKeys>>, version: string) {
  return { activeVersion: version, keys: { [version]: ring.keys[version]! } }
}
