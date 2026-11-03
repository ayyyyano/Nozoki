import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import {
  canonical,
  editableConfig,
  orderedConfig,
  validRequestKey,
} from '../../shared/contracts/admin.ts'
import {
  composeAppearance,
  migrateOverrides,
  recordAppearanceChanges,
} from '../../shared/domain/appearance-overrides.ts'
import { DEFAULT_APPEARANCE } from '../../shared/contracts/appearance.ts'
import { fieldPointer, parseFieldPath } from '../../shared/contracts/field-paths.ts'
import { defaultProtocol } from '../../shared/contracts/adapter.ts'
test('new or changed providers select a registered protocol without inventing unsupported capabilities', () => {
  assert.equal(defaultProtocol('sleepy'), 'sleepy-v5-status')
  assert.equal(defaultProtocol('deepseek'), 'deepseek-balance-v1')
  assert.equal(defaultProtocol('cliproxy-bridge'), 'cliproxy-v8-accounts')
  assert.equal(defaultProtocol('deepseek-spend'), 'unverified')
  assert.equal(defaultProtocol('quotes-custom'), 'tencent-us-v1')
})
test('request keys are UUIDv4; canonical comparison ignores keys and declared collection order', () => {
  assert.ok(validRequestKey(crypto.randomUUID()))
  assert.ok(!validRequestKey('test'))
  assert.equal(canonical({ b: 1, a: { z: 2, y: 1 } }), canonical({ a: { y: 1, z: 2 }, b: 1 }))
  const a = editableConfig(createDefaultConfig()),
    b = structuredClone(a)
  b.modules.reverse()
  b.quotes.reverse()
  assert.equal(canonical(orderedConfig(a)), canonical(orderedConfig(b)))
})
test('legacy full defaults are not permanent overrides; explicit v2 equal-default values survive', () => {
  assert.deepEqual(migrateOverrides(DEFAULT_APPEARANCE), {})
  assert.deepEqual(
    migrateOverrides({
      version: 2,
      overrides: { sourceColor: '#6750A4', background: { cardOpacity: 50 } },
    }),
    { sourceColor: '#6750A4', background: { cardOpacity: 50 } },
  )
  const shared = structuredClone(DEFAULT_APPEARANCE)
  shared.sourceColor = '#006A60'
  shared.background.cardBlur = 12
  assert.equal(composeAppearance(shared, {}).sourceColor, '#006A60')
  assert.equal(
    composeAppearance(shared, { background: { cardOpacity: 35 } }).background.cardBlur,
    12,
  )
})
test('only fields actually edited by browser users become overrides', () => {
  const after = structuredClone(DEFAULT_APPEARANCE)
  after.background.cardOpacity = 72
  assert.deepEqual(recordAppearanceChanges(DEFAULT_APPEARANCE, after, {}), {
    background: { cardOpacity: 72 },
  })
  const shared = structuredClone(DEFAULT_APPEARANCE)
  shared.sourceColor = '#0061A4'
  shared.background.cardBlur = 20
  const composed = composeAppearance(shared, { background: { cardOpacity: 72 } })
  assert.equal(composed.sourceColor, '#0061A4')
  assert.equal(composed.background.cardBlur, 20)
  assert.equal(composed.background.cardOpacity, 72)
})
test('ACL editor builds real pointer paths for future special-character nested array IDs', () => {
  const path = fieldPointer([
    'quota',
    'accounts',
    '@a.b/c~d',
    'windows',
    '@week.1/~',
    'remainingPercent',
  ])
  assert.deepEqual(parseFieldPath('codex', path), [
    'quota',
    'accounts',
    '@a.b/c~d',
    'windows',
    '@week.1/~',
    'remainingPercent',
  ])
  assert.equal(parseFieldPath('quotes', '/items/*/displayName'), null)
})
