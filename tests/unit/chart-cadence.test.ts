import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionTick, validCollectionInterval } from '../../shared/collection/cadence.ts'
import { successfulSourceSchedule } from '../../shared/collection/policy.ts'
import { createDefaultConfig, ConfigWriteSchema } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createConfigBackup, prepareConfigImport } from '../../shared/domain/config-backup.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import {
  decimalPoint,
  historyBucketIndex,
  historyWindowStart,
  latencySeries,
  statusBuckets,
} from '../../shared/domain/chart-series.ts'

test('fast cadence is restricted to UptimeFlare and stays aligned across the hour', () => {
  const source = { provider: 'uptimeflare', refreshInterval: 180 }
  const tick = Date.parse('2026-11-22T08:58:00.000Z')
  const next = '2026-11-22T09:01:00.000Z'
  assert.equal(collectionTick(tick + 30_000, 'uptimeflare'), tick)
  assert.equal(successfulSourceSchedule(tick, source), next)
  assert.equal(successfulSourceSchedule(tick + 50_000, source), next)
  assert.equal(
    successfulSourceSchedule(tick, { ...source, provider: 'sleepy' }),
    '2026-11-22T09:03:00.000Z',
  )
  for (const denied of [
    { ...source, provider: 'sleepy' },
    { ...source, refreshInterval: 181 },
    { ...source, refreshInterval: 299 },
  ])
    assert.equal(validCollectionInterval(denied), false)
})

test('legacy backup intervals normalize while explicit fast settings round trip', async () => {
  const config = createDefaultConfig()
  const draft = createIntegrationDraft('uptimeflare', config.integrations, 'history')
  const { credential: _credential, ...portable } = draft
  config.integrations.push({
    ...portable,
    refreshInterval: 180,
    credentialState: { configured: false, keyVersion: null, lastUpdatedAt: null },
  })
  const backup = createConfigBackup(config)
  assert.equal(backup.config.integrations.at(-1)?.fastUptimeFlare, true)
  const current = await prepareConfigImport(JSON.stringify(backup), config)
  assert.equal(current.config.integrations.at(-1)?.refreshInterval, 180)
  delete backup.config.integrations.at(-1)!.fastUptimeFlare
  const legacy = await prepareConfigImport(JSON.stringify(backup), config)
  assert.equal(legacy.config.integrations.at(-1)?.refreshInterval, 300)
  assert.equal(legacy.adjustedIntervals, 1)
  const invalid = editableConfig(config)
  invalid.integrations.at(-1)!.refreshInterval = 179
  assert.equal(ConfigWriteSchema.safeParse(invalid).success, false)
})

test('dense timelines retain outages and latency separates genuine zero from gaps', () => {
  const start = Date.parse('2026-11-22T00:00:00.000Z')
  const at = (min: number) => new Date(start + min * 60000).toISOString()
  const samples = [
    { at: at(0), state: 'up', latencyMs: 0 },
    { at: at(3), state: 'down', latencyMs: null },
    { at: at(6), state: 'up', latencyMs: 30 },
    { at: at(21), state: 'up', latencyMs: 40 },
  ] as const
  const dense = statusBuckets(samples, 4, start + 21 * 60000)
  assert.equal(dense.length, 4)
  assert.equal(dense[3]?.state, 'down')
  assert.equal(dense[3]?.focusAt, Date.parse(at(3)))
  assert.equal(dense[2]?.state, 'missing')
  assert.deepEqual(
    latencySeries(samples, 4.5 * 60000).map((point) => point.value),
    [0, null, 30, null, 40],
  )
  assert.equal(
    decimalPoint('day', '今日', '-0.00000000000000000025', 'CNY').display,
    '-0.00000000000000000025 CNY',
  )
})

test('homepage history uses a real 12-hour window and keeps the highest-priority observation', () => {
  const until = Date.parse('2026-11-22T12:00:00.000Z')
  const start = historyWindowStart(until)
  const hour = 3600000
  const points = [
    { at: -1, state: 'down' },
    { at: 0, state: 'up' },
    { at: 1, state: 'down' },
    { at: hour - 1, state: 'up' },
    { at: hour, state: 'maintenance' },
    { at: hour + 1, state: 'pending' },
    { at: hour * 2, state: 'pending' },
    { at: hour * 2 + 1, state: 'unknown' },
    { at: hour * 3, state: 'unknown' },
    { at: hour * 3 + 1, state: 'up' },
    { at: hour * 4, state: null },
    { at: hour * 12, state: 'up' },
    { at: hour * 12 + 1, state: 'down' },
  ] as const
  const samples = points
    .map(({ at, state }) => ({
      at: new Date(start + at).toISOString(),
      state,
      latencyMs: null,
    }))
    .reverse()
  const regular = statusBuckets(samples, 12, until)
  const wide = statusBuckets(samples, 16, until)
  assert.equal(regular.length, 12)
  assert.equal(wide.length, 16)
  assert.ok(regular.every(({ start, end }) => end - start === 60 * 60000))
  assert.ok(wide.every(({ start, end }) => end - start === 45 * 60000))
  assert.deepEqual(
    regular.slice(0, 5).map(({ state }) => state),
    ['down', 'maintenance', 'pending', 'unknown', 'missing'],
  )
  assert.equal(regular.at(-1)?.state, 'up')
  assert.equal(regular[0]?.count, 3)
  assert.equal(regular[0]?.focusAt, start + 1)
  assert.equal(historyBucketIndex(regular, start + hour), 1)
  assert.equal(historyBucketIndex(wide, start + hour * 3 - 1), 3)
  assert.equal(historyBucketIndex(wide, start + hour * 3), 4)
  assert.equal(historyBucketIndex(wide, until), 15)
  assert.equal(historyBucketIndex(regular, until + 1), -1)
  assert.ok(statusBuckets([], 12, until).every(({ state, count }) => state === 'missing' && !count))
})
