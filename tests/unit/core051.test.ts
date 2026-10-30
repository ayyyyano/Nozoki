import test from 'node:test'
import assert from 'node:assert/strict'
import { cpaSource, credentials, now } from '../fixtures/core051.ts'
import { source, replies } from '../fixtures/adapters.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { responseTransport, assertProductionTarget } from '../../server/adapters/transport.ts'
import { hmacKey, randomToken, hashToken } from '../../server/services/auth-crypto.ts'
import { pluginWindows } from '../../server/adapters/codex-observations.ts'
import {
  createPrivateRelay,
  privatePlan,
  privateRoute,
  readPrivateSource,
} from '../../server/adapters/private-relay.ts'
import { balanceChange } from '../../shared/domain/balance-change.ts'
import { decimalDifference } from '../../shared/domain/decimal.ts'
import { DataSchemas } from '../../shared/contracts/snapshots.ts'
import { parseFieldPath, fieldPointer } from '../../shared/contracts/field-paths.ts'
const key = await hmacKey(randomToken())
const identitySecret = randomToken(),
  identityVersion = await hashToken(identitySecret)
async function read(value: unknown = credentials()) {
  const s = cpaSource()
  return runAdapter({
    source: s,
    now,
    identityKey: key,
    transport: responseTransport(s, async (endpoint) => {
      assert.equal(endpoint, 'v8/management/credentials')
      return Response.json(value)
    }),
  })
}
test('Codex credentials become safe account states and passive windows in one read, not a quota probe', async () => {
  const r = await read()
  assert.equal(r.status, 'ok')
  const data = r.views.codex!.data!
  assert.deepEqual(
    data.accounts!.map((a) => a.state),
    ['ready', 'disabled', 'auth_error', 'pending'],
  )
  assert.equal(data.quota!.accounts[0]!.windows[0]!.remainingPercent, '74.875')
  assert.equal(data.quota!.accounts[0]!.windows[0]!.basis, 'passive_headers')
  assert.equal(data.usage, null)
  assert.equal(data.estimatedCost, null)
  assert.equal(data.capabilities.accounts!.verified, true)
  assert.equal(data.accounts![0]!.executionCounts!.failed, 0)
  assert.equal(data.accounts![0]!.executionCounts!.scope, 'source_runtime')
  assert.equal(data.accounts![1]!.executionCounts, null)
  assert.ok(data.accounts!.every((a) => /^[a-f0-9]{64}$/.test(a.id)))
  for (const marker of [
    '@example.invalid',
    'PRIVATE-ACCESS',
    'PRIVATE-REFRESH',
    'PRIVATE-IDTOKEN',
    'PRIVATE-PATH',
    'PRIVATE-MESSAGE',
  ])
    assert.ok(!JSON.stringify(r).includes(marker))
  assert.deepEqual(
    (await read()).views.codex!.data!.accounts!.map((a) => a.id),
    data.accounts!.map((a) => a.id),
  )
})
test('missing quota/reset/time and invalid optional observations never fabricate zero or disable account status', async () => {
  const v = credentials()
  delete (v.files[0] as any).quota.signals['X-Codex-Primary-Reset-At']
  let d = (await read(v)).views.codex!.data!
  assert.equal(d.quota!.accounts[0]!.windows[0]!.resetAt, null)
  delete (v.files[0] as any).quota
  d = (await read(v)).views.codex!.data!
  assert.equal(d.quota, null)
  assert.equal(d.capabilities.quota.supported, false)
  assert.equal(d.accounts![0]!.state, 'ready')
  ;(v.files[0] as any).quota = {
    observed_at: '2026-02-30T00:00:00Z',
    signals: { 'X-Codex-Primary-Used-Percent': '0' },
  }
  d = (await read(v)).views.codex!.data!
  assert.equal(d.accounts!.length, 4)
  assert.equal(d.quota, null)
  ;(v.files[0] as any).disabled = undefined
  ;(v.files[0] as any).unavailable = undefined
  assert.equal((await read(v)).views.codex!.data!.accounts![0]!.state, 'unknown')
})
test('old observations stay stale and zero remaining stays zero; model cooldown is not an account authentication failure', async () => {
  const v = credentials()
  v.files[0]!.quota!.observed_at = '2026-10-26T00:00:00.000Z'
  v.files[0]!.quota!.signals['X-Codex-Primary-Used-Percent'] = '100'
  const w = (await read(v)).views.codex!.data!.quota!.accounts[0]!.windows[0]!
  assert.equal(w.remainingPercent, '0')
  assert.equal(w.status, 'stale')
  v.files[2]!.cooldowns![0]!.scope = 'model'
  assert.equal((await read(v)).views.codex!.data!.accounts![2]!.state, 'error')
})
test('plugin quota parser respects optional reset and fraction bounds without invoking a plugin', () => {
  const v = {
    groups: [
      {
        displayName: 'weekly',
        buckets: [
          {
            window: 'primary',
            remainingFraction: 0,
            access_token: 'PRIVATE',
            description: 'PRIVATE',
          },
        ],
      },
    ],
  }
  const w = pluginWindows(v)
  assert.equal(w[0]!.remainingPercent, '0')
  assert.equal(w[0]!.resetAt, null)
  assert.ok(!JSON.stringify(w).includes('PRIVATE'))
  assert.throws(() => pluginWindows({ groups: [{ buckets: [{ window: 'x' }] }] }))
  assert.throws(() =>
    pluginWindows({ groups: [{ buckets: [{ window: 'x', remainingFraction: 2 }] }] }),
  )
})
test('new DTO fields and encoded account selectors have exact ACL paths; old snapshots still validate', async () => {
  const data = (await read()).views.codex!.data!
  assert.ok(DataSchemas.codex.safeParse(data).success)
  const { accounts, ...old } = data
  assert.ok(DataSchemas.codex.safeParse(old).success)
  for (const path of [
    ['accounts', '@a.b/~', 'state'],
    ['accounts', '*', 'retryAt'],
    ['quota', 'accounts', '@a.b', 'windows', '@weekly/~', 'observedAt'],
    ['quota', 'accounts', '*', 'windows', '*', 'basis'],
  ])
    assert.deepEqual(parseFieldPath('codex', fieldPointer(path)), path)
  assert.equal(parseFieldPath('codex', '/accounts/*/email'), null)
})
test('private service binding fetches a normalized relay, with separate local management credentials', async () => {
  const s = cpaSource(),
    token = randomToken()
  let count = 0
  const relay = await createPrivateRelay(
    [{ source: s, credential: 'LOCAL-MANAGEMENT-051' }],
    token,
    async (input, init) => {
      count++
      assert.equal(String(input), 'https://example.invalid/service/v8/management/credentials')
      assert.ok(new Headers(init?.headers).get('authorization') === 'Bearer LOCAL-MANAGEMENT-051')
      assert.equal(new Headers(init?.headers).get('cookie'), null)
      assert.equal(init?.method, 'GET')
      assert.equal(init?.redirect, 'manual')
      return Response.json({ ...credentials(), observed_at: new Date().toISOString() })
    },
    identitySecret,
  )
  const env = {
    NOZOKI_PRIVATE_ROUTES: JSON.stringify([{ ...privateRoute(s), identityVersion }]),
    NOZOKI_PRIVATE_RELAY_TOKEN: token,
    NOZOKI_PRIVATE_RELAY: {
      fetch: (input: Request | string, init?: RequestInit) => relay(new Request(input, init)),
    },
  }
  const r = await readPrivateSource(s, env, 'read')
  assert.equal(r.status, 'ok')
  assert.equal(r.items, 4)
  assert.equal(count, 1)
  assert.ok(!JSON.stringify(r).includes('LOCAL-MANAGEMENT'))
  assert.throws(() => assertProductionTarget(s), { code: 'TARGET_NOT_APPROVED' })
  const wrong = { ...s, baseUrl: 'https://evil.invalid/' }
  assert.throws(() => privatePlan(wrong, env), { code: 'TARGET_NOT_APPROVED' })
  assert.equal(count, 1)
  for (const mutate of [
    (v: any) => {
      v.nonce = crypto.randomUUID()
    },
    (v: any) => {
      v.revision = '0'.repeat(64)
    },
    (v: any) => {
      v.identityVersion = '0'.repeat(64)
    },
    (v: any) => {
      v.views.deepseek = {}
    },
    (v: any) => {
      v.collectedAt = '2020-01-01T00:00:00.000Z'
    },
  ]) {
    const faulty = {
      ...env,
      NOZOKI_PRIVATE_RELAY: {
        fetch: async (input: Request | string, init?: RequestInit) => {
          const v = await (await relay(new Request(input, init))).json()
          mutate(v)
          return Response.json(v)
        },
      },
    }
    await assert.rejects(() => readPrivateSource(s, faulty, 'read'), { code: 'INVALID_RESPONSE' })
  }
})
test('relay authentication rotation preserves account ACL identities; missing stable identity key is refused', async () => {
  const s = cpaSource(),
    firstToken = randomToken(),
    secondToken = randomToken()
  const wire: typeof fetch = async () => Response.json(credentials())
  await assert.rejects(
    () => createPrivateRelay([{ source: s }], firstToken, wire),
    /STABLE_RELAY_IDENTITY_KEY_REQUIRED/,
  )
  await assert.rejects(
    () => createPrivateRelay([{ source: s }], firstToken, wire, firstToken),
    /STABLE_RELAY_IDENTITY_KEY_REQUIRED/,
  )
  const ids: string[][] = []
  for (const token of [firstToken, secondToken]) {
    const relay = await createPrivateRelay(
      [{ source: s, credential: 'LOCAL' }],
      token,
      wire,
      identitySecret,
    )
    const result = await readPrivateSource(
      s,
      {
        NOZOKI_PRIVATE_ROUTES: JSON.stringify([{ ...privateRoute(s), identityVersion }]),
        NOZOKI_PRIVATE_RELAY_TOKEN: token,
        NOZOKI_PRIVATE_RELAY: {
          fetch: (input: Request | string, init?: RequestInit) => relay(new Request(input, init)),
        },
      },
      'read',
    )
    ids.push(result.views.codex!.data!.accounts!.map((a) => a.id))
  }
  assert.deepEqual(ids[0], ids[1])
})
test('private routing pins protocol, root and field mappings; missing bindings never fall back to global fetch', () => {
  const s = source('uptime-kuma'),
    token = randomToken(),
    env = {
      NOZOKI_PRIVATE_ROUTES: JSON.stringify([privateRoute(s)]),
      NOZOKI_PRIVATE_RELAY_TOKEN: token,
      NOZOKI_PRIVATE_RELAY: { fetch: async () => Response.json({}) },
    }
  assert.doesNotThrow(() => privatePlan(s, env))
  for (const change of [
    { protocolVersion: 'unknown' },
    { baseUrl: 'https://example.invalid/other/' },
    { fieldMappings: { status_page_slug: 'other' } },
  ])
    assert.throws(() => privatePlan({ ...s, ...change }, env), { code: 'TARGET_NOT_APPROVED' })
  assert.throws(() => privatePlan(s, {}), { code: 'TARGET_NOT_APPROVED' })
})
test('relay blocks arbitrary paths, queue, writes, missing token, bad nonce, cross-site and redirects', async () => {
  const s = cpaSource(),
    token = randomToken()
  let count = 0
  const relay = await createPrivateRelay(
    [{ source: s, credential: 'LOCAL' }],
    token,
    async () => {
      count++
      return new Response('', { status: 302, headers: { Location: 'https://evil.invalid' } })
    },
    identitySecret,
  )
  const headers = { Authorization: 'Bearer ' + token, 'X-Nozoki-Request': crypto.randomUUID() }
  for (const path of [
    '/v8/management/usage-queue',
    '/v1/sources/fixture/read?url=https://evil.invalid',
    '/v1/sources/fixture/../read',
    '/v1/sources/fixture/quota',
  ])
    assert.ok(
      (await relay(new Request('http://nozoki-private.internal' + path, { headers }))).status >=
        400,
    )
  assert.equal(
    (
      await relay(
        new Request('http://nozoki-private.internal/v1/sources/fixture/read', {
          headers: { ...headers, Origin: 'https://evil.invalid' },
        }),
      )
    ).status,
    400,
  )
  assert.equal(
    (await relay(new Request('http://nozoki-private.internal/v1/sources/fixture/read'))).status,
    401,
  )
  assert.equal(count, 0)
  const value = (await (
    await relay(new Request('http://nozoki-private.internal/v1/sources/fixture/read', { headers }))
  ).json()) as any
  assert.equal(value.code, 'REDIRECT_REJECTED')
  assert.equal(count, 1)
})
test('Sleepy and monitoring keep usable states through the same private normalized interface', async () => {
  for (const p of ['sleepy', 'uptime-kuma', 'uptimeflare'] as const) {
    const s = source(p),
      map = replies(p),
      token = randomToken()
    const relay = await createPrivateRelay([{ source: s }], token, async (input) => {
      const endpoint = String(input).replace(s.baseUrl!, '')
      return Response.json(map[endpoint])
    })
    const env = {
      NOZOKI_PRIVATE_ROUTES: JSON.stringify([privateRoute(s)]),
      NOZOKI_PRIVATE_RELAY_TOKEN: token,
      NOZOKI_PRIVATE_RELAY: {
        fetch: (input: Request | string, init?: RequestInit) => relay(new Request(input, init)),
      },
    }
    const r = await readPrivateSource(s, env, 'read')
    assert.ok(['ok', 'stale'].includes(r.status))
    assert.ok(r.items > 0)
    if (p === 'sleepy') {
      assert.equal(r.views.devices!.data!.devices[0]!.online, false)
      assert.equal(r.views.devices!.data!.devices[0]!.batteryPercent, null)
    }
  }
})
test('balance movements remain exact, flag gaps and ambiguous gift decreases, never infer official spending', () => {
  const a = {
      sourceId: 'a',
      seriesRevision: 'v1',
      currency: 'CNY',
      at: '2026-10-27T00:00:00.000Z',
      total: '100.000000000000000001',
      granted: '10.00',
      toppedUp: '90.000000000000000001',
    },
    b = {
      ...a,
      at: '2026-10-27T00:05:00.000Z',
      total: '104.000000000000000001',
      granted: '9',
      toppedUp: '95.000000000000000001',
    }
  assert.equal(balanceChange(null, a, 60), null)
  const r = balanceChange(a, b, 60)!
  assert.equal(r.net, '4')
  assert.equal(r.grantedNet, '-1')
  assert.equal(r.paidNet, '5')
  assert.equal(r.officialSpend, null)
  assert.equal(r.coverageGap, true)
  assert.equal(r.grantDecreaseCause, 'consumption_or_expiry_unknown')
  assert.equal(
    decimalDifference('0.000000000000000002', '0.000000000000000001'),
    '0.000000000000000001',
  )
  assert.throws(() => balanceChange(a, { ...b, currency: 'USD' }, 60))
})
