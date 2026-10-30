import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COLLECTION_BUDGET,
  retryPlan,
  successfulSchedule,
  expiresAt,
  quotaExpired,
  failureStatus,
  safeCollectionCode,
} from '../../shared/collection/policy.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { source } from '../fixtures/adapters.ts'
const now = Date.parse('2026-10-27T00:00:00.000Z')
test('portable collection timing is bounded, interval aware and protects authenticated failures', () => {
  assert.equal(COLLECTION_BUDGET.concurrency, 1)
  assert.equal(successfulSchedule(now, 60), '2026-10-27T00:05:00.000Z')
  assert.equal(successfulSchedule(now, 1800), '2026-10-27T00:30:00.000Z')
  assert.equal(expiresAt(new Date(now).toISOString(), 60), '2026-10-27T00:10:00.000Z')
  const auth = retryPlan(now, 60, 1, 'AUTH_REQUIRED')
  assert.equal(Date.parse(auth.nextRunAt) - now, 3600000)
  assert.ok(Date.parse(retryPlan(now, 60, 999, 'TIMEOUT').nextRunAt) - now <= 21600000)
})
test('vendor Retry-After survives ordinary retries and longer values remain finite', () => {
  const r = retryPlan(now, 60, 1, 'RATE_LIMITED', 86400)
  assert.equal(r.nextRunAt, '2026-10-28T00:00:00.000Z')
  assert.equal(
    retryPlan(now + 300000, 60, 1, 'TIMEOUT', undefined, r.retryAfterUntil).nextRunAt,
    r.nextRunAt,
  )
  assert.ok(
    Date.parse(retryPlan(now, 60, 1, 'RATE_LIMITED', Number.MAX_SAFE_INTEGER).nextRunAt) <=
      now + 31536000000,
  )
})
test('quota expiry is a pure decision; zero, missing reset and explicit stale remain distinct', () => {
  assert.equal(quotaExpired({ resetAt: null, status: 'ok' }, now), false)
  assert.equal(quotaExpired({ resetAt: '2026-10-26T00:00:00.000Z' }, now), true)
  assert.equal(quotaExpired({ resetAt: null, status: 'stale' }, now), true)
  assert.equal(failureStatus('AUTH_REQUIRED'), 'error')
  assert.equal(failureStatus('TARGET_NOT_APPROVED'), 'unsupported')
  assert.equal(safeCollectionCode('<private upstream message>'), 'INVALID_RESPONSE')
})
test('collection planning merges module references, ignores local-only tasks and does not use global appearance versions', () => {
  const config = createDefaultConfig(),
    s = source('sleepy')
  config.integrations = [s]
  const state = {
    config,
    integrations: [{ settings: s, envelope: null, revision: 'generation:1' }],
    snapshots: [],
  }
  config.modules.find((m) => m.id === 'devices')!.sources = {
    main: { sourceId: s.id, subject: 'devices' },
  }
  config.modules.find((m) => m.id === 'activity')!.sources = {
    main: { sourceId: s.id, subject: 'activity' },
  }
  let plans = collectionPlans(state)
  assert.equal(plans.length, 1)
  assert.equal(plans[0]!.references.length, 2)
  config.site.siteName = 'Appearance-only change'
  assert.equal(collectionPlans(state)[0]!.revision, plans[0]!.revision)
  config.modules.find((m) => m.id === 'devices')!.enabled = false
  assert.equal(collectionPlans(state).length, 0)
  config.integrations[0]!.enabled = false
  assert.equal(collectionPlans(state).length, 0)
})
