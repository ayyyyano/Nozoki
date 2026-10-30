import test from 'node:test'
import assert from 'node:assert/strict'
import { COLOR_PRESETS, parseSourceColor } from '../../shared/domain/color-input.ts'
import { COLOR_ROLES, createThemeColors } from '../../shared/domain/theme-colors.ts'
import { parseAppearance } from '../../shared/contracts/appearance.ts'
import { Contrast, argbFromHex, lstarFromArgb } from '@material/material-color-utilities'
test('strict source RGB parser accepts only complete bounded RGB or six-digit HEX', () => {
  assert.equal(parseSourceColor('rgb(103, 80, 164)'), '#6750A4')
  assert.equal(parseSourceColor(' #006a60 '), '#006A60')
  for (const value of [
    '#fff',
    '#12345678',
    'rgb(256,0,0)',
    'rgb(-1,0,0)',
    'rgb(1.5,2,3)',
    'rgb(1%,2%,3%)',
    'var(--x)',
    'red',
    'url(x)',
    '#6750A4; color:red',
    'rgb(1,2,3)/*x*/',
  ])
    assert.equal(parseSourceColor(value), null, value)
})
test('all presets and extreme custom colors produce complete contrast-aware light and dark roles', () => {
  for (const source of [...COLOR_PRESETS.map((p) => p.color), '#000000', '#FFFFFF', '#FF0000'])
    for (const dark of [false, true]) {
      const c = createThemeColors(source, dark)
      for (const role of Object.keys(COLOR_ROLES))
        assert.match(c[`--color-${role}`]!, /^#[0-9a-f]{6}$/)
      for (const [a, b] of [
        ['primary', 'on-primary'],
        ['secondary', 'on-secondary'],
        ['tertiary', 'on-tertiary'],
        ['surface', 'on-surface'],
        ['error', 'on-error'],
        ['inverse-surface', 'inverse-on-surface'],
      ]) {
        const contrast = Contrast.ratioOfTones(
          lstarFromArgb(argbFromHex(c[`--color-${a}`]!)),
          lstarFromArgb(argbFromHex(c[`--color-${b}`]!)),
        )
        assert.ok(contrast >= 4.5, `${source} ${dark} ${a} ${contrast}`)
      }
    }
})
test('old appearance records migrate without changing unrelated preferences', () => {
  const old = parseAppearance({ mode: 'dark', preset: 'm2', background: { x: 25, cardBlur: 12 } })
  assert.equal(old.sourceColor, '#6750A4')
  assert.equal(old.background.x, 25)
  assert.equal(parseAppearance({ sourceColor: 'rgb(103,80,164)' }).sourceColor, '#6750A4')
  assert.equal(parseAppearance({ sourceColor: 'bad' }).sourceColor, '#6750A4')
})
