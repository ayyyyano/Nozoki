import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAppearance, DEFAULT_APPEARANCE } from '../../shared/contracts/appearance.ts'

test('old theme presets migrate to M3 while retaining explicit mode and background', () => {
  for (const preset of ['m2', 'm3', 'glass', 'tide']) {
    const parsed = parseAppearance({
      preset,
      mode: 'dark',
      background: { layout: 'banner', overlay: 32 },
    })
    assert.equal('preset' in parsed, false)
    assert.equal(parsed.mode, 'dark')
    assert.equal(parsed.background.layout, 'banner')
    assert.equal(parsed.background.overlay, 32)
    assert.equal(parsed.background.cardOpacity, 50)
    assert.equal(parsed.background.cardBlur, 8)
  }
})
test('new visits follow system with a page background and independent card controls', () => {
  const parsed = parseAppearance(null)
  assert.deepEqual(parsed, DEFAULT_APPEARANCE)
  assert.equal(parsed.mode, 'system')
  assert.equal(parsed.background.layout, 'page')
  parsed.background.cardOpacity = 0
  assert.equal(DEFAULT_APPEARANCE.background.cardOpacity, 50)
})
test('new surface defaults do not overwrite explicit saved opacity and blur', () => {
  const saved = parseAppearance({ background: { cardOpacity: 72, cardBlur: 6 } })
  assert.equal(saved.background.cardOpacity, 72)
  assert.equal(saved.background.cardBlur, 6)
})
test('transparent backgrounds and zero blur are valid; invalid and oversized values normalize', () => {
  assert.equal(
    parseAppearance({ background: { cardOpacity: 0, cardBlur: 0 } }).background.cardOpacity,
    0,
  )
  assert.equal(
    parseAppearance({ background: { cardOpacity: 0, cardBlur: 0 } }).background.cardBlur,
    0,
  )
  const parsed = parseAppearance({
    mode: 'invalid',
    background: { cardOpacity: -1, cardBlur: 50, x: NaN, y: Infinity },
  })
  assert.equal(parsed.background.cardOpacity, 0)
  assert.equal(parsed.background.cardBlur, 20)
  assert.equal(parsed.background.x, 50)
  assert.equal(parsed.background.y, 35)
  assert.equal(parsed.mode, 'system')
})
