import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dashboardPlan,
  canonicalModules,
  MODULE_DISPLAY_ORDER,
  moduleRole,
} from '../../shared/domain/module-layout.ts'
import {
  ConfigSchema,
  ConfigWriteSchema,
  createDefaultConfig,
} from '../../shared/contracts/config.ts'
import { editableConfig, orderedConfig } from '../../shared/contracts/admin.ts'

test('all grid capacities handle arbitrary counts without reserved business slots', () => {
  for (const capacity of [1, 2, 3, 4] as const)
    for (let count = 0; count <= 30; count++) {
      for (const links of [false, true]) {
        const plan = dashboardPlan(count, capacity, links)
        assert.ok(plan.columns >= 1 && plan.columns <= capacity)
        assert.ok(plan.columns <= Math.max(1, count))
        if (plan.links === 'cell') {
          assert.ok(links && count >= 5)
          assert.equal((count + 1) % plan.columns, 0)
        }
      }
    }
  assert.deepEqual(dashboardPlan(4, 3, true), { columns: 2, links: 'strip' })
  assert.deepEqual(dashboardPlan(5, 3, true), { columns: 3, links: 'cell' })
  assert.deepEqual(dashboardPlan(6, 3, true), { columns: 3, links: 'strip' })
  assert.deepEqual(dashboardPlan(7, 3, true), { columns: 3, links: 'strip' })
  assert.deepEqual(dashboardPlan(8, 3, true), { columns: 3, links: 'cell' })
  assert.deepEqual(dashboardPlan(4, 4, true), { columns: 2, links: 'strip' })
  assert.deepEqual(dashboardPlan(5, 4, true), { columns: 3, links: 'cell' })
  assert.deepEqual(dashboardPlan(6, 4, true), { columns: 3, links: 'strip' })
  assert.deepEqual(dashboardPlan(7, 4, true), { columns: 4, links: 'cell' })
  assert.deepEqual(dashboardPlan(7, 4, false), { columns: 4, links: 'strip' })
  assert.deepEqual(dashboardPlan(8, 4, true), { columns: 4, links: 'strip' })
})

test('new business modules and renamed headings never change navigation role or canonical order', () => {
  const input = [...MODULE_DISPLAY_ORDER, 'future-z', 'future-a'].toReversed().map((id, i) => ({
    id,
    sortOrder: i,
    title: '服务状态',
    fields: { private: true },
    enabled: i % 2 === 0,
  }))
  const before = structuredClone(input)
  const result = canonicalModules(input)
  assert.deepEqual(
    result.map((m) => m.id),
    [...MODULE_DISPLAY_ORDER.filter((id) => id !== 'links'), 'future-a', 'future-z', 'links'],
  )
  assert.deepEqual(
    result.map((m) => m.sortOrder),
    result.map((_, i) => i),
  )
  assert.deepEqual(input, before)
  for (const m of result) assert.deepEqual(m.fields, { private: true })
  assert.equal(moduleRole('future-a'), 'business')
  assert.equal(moduleRole('links'), 'navigation')
})

test('legacy read, write and editor drafts normalize order while preserving module policies', () => {
  const legacy = createDefaultConfig()
  legacy.modules.reverse().forEach((m, i) => {
    m.sortOrder = 9000 - i
    m.title = '自定义 ' + m.id
  })
  const read = ConfigSchema.parse(legacy)
  const write = ConfigWriteSchema.parse(editableConfig(legacy))
  assert.deepEqual(orderedConfig(editableConfig(legacy)), orderedConfig(write))
  for (const config of [read, write, editableConfig(legacy)]) {
    assert.deepEqual(
      config.modules.map((m) => m.id),
      MODULE_DISPLAY_ORDER,
    )
    assert.deepEqual(
      config.modules.map((m) => m.sortOrder),
      MODULE_DISPLAY_ORDER.map((_, i) => i),
    )
    for (const m of config.modules) {
      const old = legacy.modules.find((x) => x.id === m.id)!
      assert.deepEqual({ ...m, sortOrder: old.sortOrder }, old)
    }
  }
  const invalid = editableConfig(legacy)
  invalid.modules[0]!.sortOrder = -1
  assert.equal(ConfigWriteSchema.safeParse(invalid).success, false)
})
