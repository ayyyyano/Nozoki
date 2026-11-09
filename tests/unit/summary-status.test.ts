import test from 'node:test'
import assert from 'node:assert/strict'
import { additionalSuccess, summaryStatus } from '../../shared/domain/summary-status.ts'

test('summary statuses distinguish stale/failed collection from confirmed offline', () => {
  assert.equal(summaryStatus('stale'), '已过期')
  assert.equal(summaryStatus('error'), '采集失败')
  assert.equal(summaryStatus('offline'), '来源离线')
  assert.equal(summaryStatus('unconfigured'), '')
  assert.equal(summaryStatus('ok'), '')
})
test('the last successful read is deduplicated only against the same primary timestamp', () => {
  const success = '2026-11-09T12:00:00.000Z',
    attempt = '2026-11-09T12:05:00.000Z'
  assert.equal(additionalSuccess('error', success, attempt), success)
  assert.equal(additionalSuccess('stale', success, success), null)
  assert.equal(additionalSuccess('ok', success, attempt), null)
  assert.equal(additionalSuccess('error', null, attempt), null)
})
