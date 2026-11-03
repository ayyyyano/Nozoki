import test from 'node:test'
import assert from 'node:assert/strict'
import { storageMode } from '../../server/repositories/storage-status.ts'

const columns = [
  'id',
  'enabled',
  'title',
  'sort_order',
  'visibility',
  'guest_behavior',
  'fields_json',
  'sources_json',
].map((name) => ({ name }))
test('storage schema distinguishes legacy read-only mode from the current schema', () => {
  assert.equal(storageMode(columns), 'read-only')
  assert.equal(storageMode([...columns, { name: 'ip_visibility' }]), 'ready')
})
test('an absent or damaged schema is never treated as a usable legacy database', () => {
  assert.throws(() => storageMode([]), /CONFIG_BASELINE_INVALID/)
  assert.throws(
    () => storageMode(columns.filter((c) => c.name !== 'fields_json')),
    /CONFIG_BASELINE_INVALID/,
  )
})
