import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeServiceTarget } from '../../server/services/service-target.ts'
import {
  fieldPointer,
  parseFieldPath,
  pathPrefix,
  FIELD_MODEL,
  type FieldNode,
} from '../../shared/contracts/field-paths.ts'
import {
  ModuleSettingsSchema,
  UtcSchema,
  createDefaultConfig,
} from '../../shared/contracts/config.ts'
import { DataSchemas } from '../../shared/contracts/snapshots.ts'
import type { ModuleId } from '../../shared/contracts/dashboard.ts'
const policy = { enabled: true, visibility: 'admin' as const }
test('credential scope is the canonical full service directory, not just origin', () => {
  const root = 'https://example.invalid/api/'
  for (const url of [
    'https://EXAMPLE.invalid:443/api',
    root,
    'https://example.invalid/x/../api/',
    'https://example.invalid/%61pi/',
  ])
    assert.equal(normalizeServiceTarget(url), root)
  for (const url of [
    'https://another.invalid/api/',
    'https://example.invalid/other/',
    'https://example.invalid/API/',
    'https://example.invalid/api//',
    'https://example.invalid/api%2F/',
    'https://example.invalid/api./',
  ])
    assert.notEqual(normalizeServiceTarget(url), root)
  assert.equal(normalizeServiceTarget(null), null)
  assert.throws(() => normalizeServiceTarget('https://example.invalid/api?token=x'))
})
test('RFC6901 ACL segments roundtrip exact IDs without percent decoding or dot splitting', () => {
  for (const id of [
    'plain',
    'private.device',
    'a/b~c',
    '@*%2F# 空 格',
    '*',
    '~1',
    'id.name/stateText',
  ]) {
    const path = ['devices', '@' + id, 'stateText']
    assert.deepEqual(parseFieldPath('devices', fieldPointer(path)), path)
    assert.ok(pathPrefix(['devices', '*'], path))
    assert.ok(!pathPrefix(['devices', '@private'], path))
  }
  assert.deepEqual(parseFieldPath('devices', 'devices.@living-room'), ['devices', '@living-room'])
  assert.equal(parseFieldPath('devices', 'devices.@living-room.stateText'), null)
  assert.equal(parseFieldPath('devices', 'devices.@private.name'), null)
  assert.equal(parseFieldPath('devices', 'devices.@private.device'), null)
  assert.equal(parseFieldPath('devices', '/devices/@bad~2id'), null)
})
test('unknown, mismatched configuration fields and invalid selectors are refused', () => {
  for (const [id, path] of [
    ['quotes', 'items.*.displayName'],
    ['devices', 'devices.*.unknown'],
    ['codex', 'quota.accounts.*.windows.*.resetTime'],
    ['quotes', '/items/@QQQM/name'],
    ['devices', '/devices/0/name'],
    ['services', '/monitors/*/credential'],
    ['deepseek', '/balances/*/sourceId'],
    ['activity', '/schedule/notAField'],
    ['links', '/items/*/displayName'],
    ['devices', '/devices/*/capabilities'],
  ] as [ModuleId, string][]) {
    const m = createDefaultConfig().modules.find((m) => m.id === id)!
    m.fields = { [path]: policy }
    assert.equal(ModuleSettingsSchema.safeParse(m).success, false, `${id}: ${path}`)
  }
  assert.deepEqual(parseFieldPath('quotes', '/items/*/name'), ['items', '*', 'name'])
  assert.ok(parseFieldPath('codex', '/quota/accounts/@future.id/windows/@future~1window/resetAt'))
})
test('private ancestors cannot be loosened by public child in either path notation', () => {
  const m = createDefaultConfig().modules.find((m) => m.id === 'devices')!
  m.visibility = 'public'
  for (const fields of [
    { 'devices.*': policy, '/devices/@a.b/name': { enabled: true, visibility: 'public' as const } },
    {
      '/devices/@a.b': policy,
      '/devices/@a.b/name': { enabled: true, visibility: 'public' as const },
    },
    {
      'devices.@plain': policy,
      '/devices/@plain': { enabled: true, visibility: 'public' as const },
    },
  ])
    assert.equal(ModuleSettingsSchema.safeParse({ ...m, fields }).success, false)
})
test('every frozen ACL field corresponds to the actual snapshot DTO schema', () => {
  function members(schema: any): any[] {
    if (Array.isArray(schema)) return schema.flatMap(members)
    while (schema.unwrap && !schema.shape && !schema.element) schema = schema.unwrap()
    if (schema._def?.type === 'pipe')
      return members(schema._def.in._def?.type === 'transform' ? schema._def.out : schema._def.in)
    return schema.options ? schema.options.flatMap(members) : [schema]
  }
  function walk(model: FieldNode, schema: any, id: ModuleId, path: string[] = []) {
    const options = members(schema)
    if (path.length) assert.ok(parseFieldPath(id, fieldPointer(path)), fieldPointer(path))
    if (model === null) return
    if ('record' in model && model.keys === 'date') {
      const records = options.filter((s) => s._def?.type === 'record')
      assert.ok(records.length, fieldPointer(path))
      walk(
        model.record,
        records.map((s) => s._def.valueType),
        id,
        [...path, '*'],
      )
    } else if ('array' in model && typeof model.ids === 'boolean') {
      const arrays = options.filter((s) => s.element)
      assert.ok(arrays.length, fieldPointer(path))
      if (model.ids) for (const item of arrays) assert.ok(item.element.shape.id)
      walk(
        model.array,
        arrays.map((s) => s.element),
        id,
        [...path, '*'],
      )
    } else {
      const shape = Object.assign({}, ...options.map((s) => s.shape ?? {}))
      assert.deepEqual(
        Object.keys(model).sort(),
        Object.keys(shape)
          .filter((key) => !['sourceId', 'capabilities', 'reason'].includes(key))
          .sort(),
        `${id}:${fieldPointer(path)} complete DTO address space`,
      )
      for (const [key, child] of Object.entries(model)) {
        assert.ok(shape[key], `${id}:${fieldPointer([...path, key])}`)
        walk(
          child,
          options.flatMap((s) => (s.shape?.[key] ? [s.shape[key]] : [])),
          id,
          [...path, key],
        )
      }
    }
  }
  for (const id of Object.keys(FIELD_MODEL) as ModuleId[])
    walk(FIELD_MODEL[id], DataSchemas[id], id)
})
test('runtime timestamps reject impossible dates, offsets and noncanonical precision', () => {
  assert.ok(UtcSchema.safeParse('2024-02-29T00:00:00.000Z').success)
  for (const value of [
    '2026-02-30T00:00:00.000Z',
    '2026-10-26T08:00:00.000+08:00',
    '2026-10-26T00:00:00Z',
    '2026-10-26T24:00:00.000Z',
  ])
    assert.equal(UtcSchema.safeParse(value).success, false)
})
