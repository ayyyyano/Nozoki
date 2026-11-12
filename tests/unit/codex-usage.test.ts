import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateUsage,
  CODEX_USAGE_QUEUE,
  isCodexUsageQueueEndpoint,
  mergeUsageDays,
  UsageQueueSchema,
  usageView,
} from '../../server/adapters/codex-usage.ts'
import { hmacKey, hex, mac } from '../../server/services/auth-crypto.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import {
  endpointCatalog,
  responseTransport,
  serviceEndpoint,
} from '../../server/adapters/transport.ts'
import { cpaSource, credentials } from '../fixtures/core051.ts'
import { usageRecord } from '../fixtures/codex-usage.ts'
import {
  CODEX_QUOTA_CALL,
  quotaRequestBody,
  quotaWindows,
} from '../../server/adapters/codex-quota.ts'

const now = new Date('2026-11-10T12:00:00.000Z')
const identityKey = await hmacKey('synthetic-usage-identity')
const source = cpaSource()
const account = hex(await mac(identityKey, ['nozoki-codex-account-v1', source.id, 'a1']))
const aggregate = (records: unknown) =>
  aggregateUsage(records, identityKey, source.id, new Set([account]), now)

test('quota reads use a fixed upstream GET and classify only reported window lengths', () => {
  assert.equal(endpointCatalog(source).includes(CODEX_QUOTA_CALL), false)
  assert.throws(() => quotaRequestBody('a1\r\nInjected'))
  const body = {
    account_id: 'fixture-account',
    rate_limit: {
      primary_window: { used_percent: 0, limit_window_seconds: 604800 },
      secondary_window: {
        used_percent: 12.5,
        limit_window_seconds: 18000,
        reset_after_seconds: 60,
      },
    },
  }
  const response = { value: { status_code: 200, body: JSON.stringify(body) }, ageSeconds: null }
  assert.deepEqual(
    quotaWindows(response, now, 'fixture-account').map((w) => [
      w.id,
      w.remainingPercent,
      w.resetAt,
    ]),
    [
      ['weekly', '100', null],
      ['five-hour', '87.5', new Date(+now + 60_000).toISOString()],
    ],
  )
  assert.throws(() => quotaWindows(response, now, 'other-account'), { code: 'INVALID_RESPONSE' })
  assert.throws(() => quotaWindows({ ...response, ageSeconds: 1 }, now), {
    code: 'INVALID_RESPONSE',
  })
  body.rate_limit.secondary_window.limit_window_seconds = 2592000
  assert.equal(quotaWindows({ ...response, value: { status_code: 200, body } }, now).length, 1)
})

test('explicitly unused windows refresh at full quota even with no valid reset time', () => {
  const nowSeconds = +now / 1000
  for (const reset of [
    {},
    { reset_at: null, reset_after_seconds: null },
    { reset_at: 0, reset_after_seconds: 0 },
    { reset_at: nowSeconds },
    { reset_at: nowSeconds - 3600, reset_after_seconds: 0 },
    { reset_at: nowSeconds + 18001 },
    { reset_after_seconds: -1 },
  ]) {
    const window = { limit_window_seconds: 18000, ...reset }
    const read = (primary: unknown) =>
      quotaWindows(
        {
          value: {
            status_code: 200,
            body: { rate_limit: { primary_window: primary, secondary_window: null } },
          },
        },
        now,
      )
    assert.deepEqual(read({ ...window, used_percent: 0 }), [
      {
        id: 'five-hour',
        label: '5 小时额度',
        windowMinutes: 300,
        remainingPercent: '100',
        resetAt: null,
        observedAt: now.toISOString(),
        basis: 'quota_read',
        status: 'ok',
      },
    ])
    assert.deepEqual(read(window), [])
    assert.deepEqual(read(null), [])
    if (Object.values(reset).some(Boolean))
      assert.deepEqual(read({ ...window, used_percent: 10 }), [])
  }
})

test('queue schema rejects missing fields, wrong counters, null tokens and unknown fields', () => {
  assert.equal(UsageQueueSchema.safeParse([usageRecord()]).success, true)
  for (const field of Object.keys(usageRecord())) {
    const record = { ...usageRecord() }
    delete record[field]
    assert.equal(UsageQueueSchema.safeParse([record]).success, false, field)
  }
  for (const tokens of [
    null,
    {},
    { ...usageRecord().tokens, input_tokens: '100' },
    { ...usageRecord().tokens, total_tokens: -1 },
  ])
    assert.equal(UsageQueueSchema.safeParse([{ ...usageRecord(), tokens }]).success, false)
  assert.equal(UsageQueueSchema.safeParse([{ ...usageRecord(), extra: true }]).success, false)
  assert.equal(
    UsageQueueSchema.safeParse(Array.from({ length: 51 }, () => usageRecord())).success,
    false,
  )
})

test('UTC buckets match credential HMAC identities and preserve upstream counter semantics', async () => {
  const rows = await aggregate([
    usageRecord('2026-11-10T00:30:00+08:00'),
    { ...usageRecord('2026-11-09T23:30:00Z'), failed: true },
    usageRecord(),
    { ...usageRecord(), auth_index: 'unmatched' },
    { ...usageRecord(), provider: 'claude' },
    { ...usageRecord(), auth_index: '', source: 'a1' },
  ])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    day: '2026-11-09',
    input: 200,
    output: 40,
    reasoning: 10,
    cached: 60,
    total: 240,
    requests: 2,
    failed: 1,
  })
  assert.equal(rows[1].requests, 1)
  assert.equal(rows[1].total, 120)
  assert.equal(usageView(rows)?.coverageStart, '2026-11-09T00:00:00.000Z')
  assert.deepEqual(await aggregate([]), [])
  await assert.rejects(aggregate([usageRecord('2026-11-11T00:00:00Z')]), {
    code: 'INVALID_RESPONSE',
  })
})

test('daily merge is additive, bounded, sorted and rejects numeric overflow', async () => {
  const delta = await aggregate([usageRecord()])
  const merged = mergeUsageDays(delta, delta, now)
  assert.equal(merged[0].input, 200)
  assert.equal(merged[0].requests, 2)
  assert.deepEqual(mergeUsageDays(delta, [], now), delta)
  assert.deepEqual(mergeUsageDays([{ ...delta[0], day: '2020-01-01' }], [], now), [])
  assert.throws(
    () => mergeUsageDays([{ ...delta[0], total: Number.MAX_SAFE_INTEGER }], delta, now),
    { code: 'INVALID_RESPONSE' },
  )
})

test('transport allows only the exact bounded queue query', () => {
  assert.ok(endpointCatalog(source).includes(CODEX_USAGE_QUEUE))
  assert.ok(serviceEndpoint(source.baseUrl!, CODEX_USAGE_QUEUE).endsWith('?count=50'))
  for (const value of [
    CODEX_USAGE_QUEUE + '&x=1',
    CODEX_USAGE_QUEUE.replace('50', '500'),
    CODEX_USAGE_QUEUE.replace('?count=50', ''),
    CODEX_USAGE_QUEUE + '#x',
    CODEX_USAGE_QUEUE.replace('count', '%63ount'),
  ]) {
    assert.equal(isCodexUsageQueueEndpoint(value), false)
    if (value.includes('?')) assert.throws(() => serviceEndpoint(source.baseUrl!, value))
  }
})

async function read(mode: 'read' | 'probe', queue: unknown = [], status = 200, prior = []) {
  const calls: string[] = []
  const result = await runAdapter(
    {
      source,
      now,
      identityKey,
      codexUsageDays: prior,
      transport: responseTransport(source, async (endpoint) => {
        calls.push(endpoint)
        if (endpoint === CODEX_USAGE_QUEUE) return Response.json(queue, { status })
        const value = credentials()
        value.observed_at = now.toISOString()
        return Response.json(value)
      }),
    },
    mode,
  )
  return { result, calls }
}

test('scheduled reads pop once after credentials; probes never pop, including with prior totals', async () => {
  const prior = await aggregate([usageRecord()])
  const { result, calls } = await read('read', [usageRecord()], 200, prior)
  assert.deepEqual(calls, ['v8/management/credentials', CODEX_USAGE_QUEUE])
  assert.equal(result.status, 'ok')
  assert.equal(result.views.codex?.data?.usage?.days[0].requests, 2)
  assert.equal(result.views.codex?.data?.accounts?.[0].id, account)
  assert.equal(result.usageDelta?.[0].requests, 1)
  assert.equal(result.capabilities.usage.verified, true)
  const probe = await read('probe', [usageRecord()], 200, prior)
  assert.deepEqual(probe.calls, ['v8/management/credentials'])
  assert.equal(probe.result.usageDelta, undefined)
  assert.equal(probe.result.capabilities.usage.verified, false)
})

test('empty queues retain totals; disabled statistics degrade without failing account collection', async () => {
  const prior = await aggregate([usageRecord()])
  const empty = await read('read', [], 200, prior)
  assert.equal(empty.result.status, 'ok')
  assert.deepEqual(empty.result.views.codex?.data?.usage?.days, prior)
  assert.equal(empty.result.capabilities.usage.supported, true)
  for (const status of [400, 404]) {
    const { result, calls } = await read('read', {}, status, prior)
    assert.equal(calls.length, 2)
    assert.equal(result.status, 'ok')
    assert.equal(result.code, undefined)
    assert.equal(result.capabilities.usage.supported, false)
    assert.equal(result.capabilities.usage.reason, 'USAGE_STATISTICS_DISABLED')
    assert.deepEqual(result.views.codex?.data?.usage?.days, prior)
  }
  assert.equal((await read('read', [], 503)).result.code, 'UPSTREAM_UNAVAILABLE')
  assert.equal(
    (await read('read', [{ ...usageRecord(), tokens: null }])).result.code,
    'INVALID_RESPONSE',
  )
})
