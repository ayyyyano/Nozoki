import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultConfig, ModuleSettingsSchema } from '../../shared/contracts/config.ts'
import { orderedHomeItems, itemKey, ITEM_HOME_LIMITS } from '../../shared/domain/item-display.ts'

const item = (itemId: string, sourceId = 'source') => ({ itemId, sourceId })
const accepts = (id, presentation) =>
  ModuleSettingsSchema.safeParse({
    ...createDefaultConfig().modules.find((module) => module.id === id),
    presentation,
  }).success

test('item presentation validates namespace, unique identities, ordered capacity and override safety', () => {
  assert.ok(
    accepts('devices', {
      deviceHome: [],
      deviceOverrides: [{ ...item('a/~'), icon: 'WatchRound' }],
    }),
  )
  assert.ok(accepts('devices', { deviceHome: [item('same'), item('same', 'other')] }))
  assert.ok(
    accepts('services', { serviceAliases: [{ ...item('source/home'), alias: '<b>主页</b>' }] }),
  )
  assert.ok(
    accepts('tailscale', {
      tailnetHome: [item('node')],
      tailnetAliases: [{ ...item('node'), alias: '工作节点' }],
    }),
  )
  assert.ok(!accepts('devices', { deviceHome: [item('same'), item('same')] }))
  assert.ok(!accepts('devices', { deviceHome: [{ ...item('same'), order: 0 }] }))
  assert.ok(!accepts('devices', { deviceHome: [item('same', 'Bad Source')] }))
  assert.ok(
    !accepts('devices', { deviceHome: Array.from({ length: 5 }, (_, i) => item(String(i))) }),
  )
  assert.ok(
    !accepts('tailscale', { tailnetHome: Array.from({ length: 9 }, (_, i) => item(String(i))) }),
  )
  assert.ok(!accepts('devices', { deviceOverrides: [{ ...item('x'), icon: '<svg />' }] }))
  assert.ok(!accepts('services', { serviceAliases: [{ ...item('other/home'), alias: 'x' }] }))
  assert.ok(!accepts('services', { deviceHome: [] }))
  assert.ok(!accepts('tailscale', { tailnetAliases: [{ ...item('x'), alias: 'node 100.64.0.1' }] }))
  for (const alias of [' ', 'x\u0000', 'x\u202e', '长'.repeat(81)])
    assert.ok(!accepts('services', { serviceAliases: [{ ...item('source/x'), alias }] }))
  assert.notEqual(itemKey(item('b/c', 'a')), itemKey(item('c', 'a-b')))
})

test('home summaries cap automatic choices, preserve explicit empty and skip missing IDs without substitution', () => {
  for (const limit of Object.values(ITEM_HOME_LIMITS)) {
    for (const count of [0, 1, 2, 3, 4, 5, 8, 9]) {
      const items = Array.from({ length: count }, (_, i) => ({ id: String(i), name: 'renamed' }))
      assert.equal(orderedHomeItems(items, undefined, limit).length, Math.min(count, limit))
      assert.deepEqual(orderedHomeItems(items, [], limit), [])
    }
  }
  const rows = [{ id: '1' }, { id: '2' }, { id: '3' }]
  assert.deepEqual(orderedHomeItems(rows, ['3', 'missing', '1'], 4), [rows[2], rows[0]])
})
