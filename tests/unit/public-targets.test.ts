import test from 'node:test'
import assert from 'node:assert/strict'
import { publicTarget, publicServiceRoot } from '../../server/adapters/public-targets.ts'
import { productionTransport } from '../../server/adapters/transport.ts'
import { collectSource } from '../../server/collection/read.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { source, replies, now } from '../fixtures/adapters.ts'
import type { CollectionPlan } from '../../server/collection/plans.ts'

const sleepy = () => ({ ...source('sleepy'), baseUrl: 'https://sleepy.example.com/service/' })
function environment(s = sleepy(), authentication = 'none') {
  return {
    NOZOKI_PUBLIC_ROUTES: JSON.stringify([
      {
        id: s.id,
        provider: s.provider,
        protocolVersion: s.protocolVersion,
        baseUrl: s.baseUrl,
        authentication,
      },
    ]),
  }
}

test('deployment-owned public routes match provider, protocol and complete normalized root', () => {
  const s = sleepy(),
    env = environment(s)
  assert.equal(publicTarget(s), undefined)
  assert.deepEqual(publicTarget({ ...s, baseUrl: 'https://SLEEPY.EXAMPLE.COM:443/service' }, env), {
    baseUrl: s.baseUrl,
    authentication: 'none',
  })
  for (const change of [
    { provider: 'deepseek' as const },
    { protocolVersion: 'unknown' },
    { baseUrl: 'https://other.example.com/service/' },
    { baseUrl: 'https://sleepy.example.com/other/' },
  ])
    assert.throws(() => publicTarget({ ...s, ...change }, env), { code: 'TARGET_NOT_APPROVED' })
  assert.equal(publicTarget({ ...s, id: 'not-approved' }, env), undefined)
  assert.equal(
    publicTarget({ ...source('deepseek'), baseUrl: 'https://api.deepseek.com/' })?.authentication,
    'bearer',
  )
})

test('public approval rejects malformed lists, broad patterns and restricted URL forms', () => {
  const s = sleepy()
  for (const base of [
    'https://localhost/',
    'https://localhost.example.internal/',
    'https://127.0.0.1/',
    'https://10.0.0.1/',
    'https://172.16.0.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://2130706433/',
    'https://0177.0.0.1/',
    'https://0x7f000001/',
    'http://sleepy.example.com/',
    'https://sleepy.example.com:8443/',
    'https://user:pass@sleepy.example.com/',
    'https://*.example.com/',
    'https://sleepy.example.com./',
    'https://sleepy.example.com/a/../b/',
    'https://sleepy.example.com/a%2fb/',
    'https://sleepy.example.com/?key=value',
    'https://sleepy.example.com/#fragment',
    'https://sleepy.example.com/a\\b/',
  ]) {
    assert.throws(() => publicServiceRoot(base), { code: 'TARGET_NOT_APPROVED' }, base)
    assert.throws(() => publicTarget(s, environment({ ...s, baseUrl: base })), {
      code: 'TARGET_NOT_APPROVED',
    })
  }
  const route = JSON.parse(environment().NOZOKI_PUBLIC_ROUTES)[0]
  for (const raw of [
    '{',
    '{}',
    JSON.stringify([route, route]),
    JSON.stringify([{ ...route, authentication: 'cookie' }]),
    JSON.stringify([{ ...route, endpoints: ['anything'] }]),
  ])
    assert.throws(() => publicTarget(s, { NOZOKI_PUBLIC_ROUTES: raw }), {
      code: 'TARGET_NOT_APPROVED',
    })
})

test('approved public Sleepy runs real adapter with bounded GETs and no inherited credential or Cookie', async () => {
  const s = sleepy(),
    messages: string[] = [],
    fixtures = replies('sleepy')
  const transport = productionTransport(s, 'MUST-NOT-BE-FORWARDED', {
    environment: environment(s),
    fetch: async (url, init) => {
      messages.push(String(url))
      assert.equal(init?.method, 'GET')
      assert.equal(init?.redirect, 'manual')
      assert.equal(init?.credentials, 'omit')
      assert.equal(init?.cache, 'no-store')
      assert.ok(init?.signal instanceof AbortSignal)
      assert.deepEqual([...new Headers(init?.headers).keys()], ['accept'])
      return Response.json(fixtures[String(url).replace(s.baseUrl, '')])
    },
  })
  const result = await runAdapter({ source: s, transport, now })
  assert.equal(result.code, undefined)
  assert.ok(result.views.devices)
  assert.equal(messages.length, 1)
  for (const path of [
    'api/device/set',
    '../api/meta',
    'api%2fmeta',
    'api/meta?url=https://evil.example.com',
  ])
    await assert.rejects(transport.get(path), { code: 'TARGET_NOT_APPROVED' })
  assert.equal(messages.length, 1)
})

test('public bearer policy requires credential, cannot follow redirect, and keeps request budget', async () => {
  const s = sleepy(),
    env = environment(s, 'bearer')
  assert.throws(() => productionTransport(s, undefined, { environment: env }), {
    code: 'AUTH_REQUIRED',
  })
  assert.throws(() => productionTransport(s, 'bad\r\nsecret', { environment: env }), {
    code: 'CREDENTIAL_INVALID',
  })
  let calls = 0
  const transport = productionTransport(s, 'synthetic-key', {
    environment: env,
    fetch: async (_url, init) => {
      calls++
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-key')
      return new Response(null, {
        status: 302,
        headers: { location: 'https://other.example.com/' },
      })
    },
  })
  await assert.rejects(transport.get('api/meta'), { code: 'REDIRECT_REJECTED' })
  assert.equal(calls, 1)
  await assert.rejects(transport.get('api/meta'), { code: 'REDIRECT_REJECTED' })
  await assert.rejects(transport.get('api/meta'), { code: 'REQUEST_BUDGET' })
  assert.equal(calls, 2)
})

test('retired deployment routes cannot authorize an unapproved legacy collector source', async () => {
  const s = sleepy(),
    metrics = { requests: 0, responseBytes: 0 }
  const p: CollectionPlan = {
    source: s,
    revision: 'fixture',
    envelope: null,
    configVersion: 1,
    references: [{ moduleId: 'devices', subject: 'default' }],
  }
  for (const env of [environment(s), {}])
    await assert.rejects(collectSource(p, env, new AbortController().signal, now, metrics), {
      code: 'ACCESS_NOT_APPROVED',
    })
  assert.deepEqual(metrics, { requests: 0, responseBytes: 0 })
})
