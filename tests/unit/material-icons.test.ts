import assert from 'node:assert/strict'
import test from 'node:test'
import { LinkSettingsSchema } from '../../shared/contracts/config.ts'
import {
  materialIconName,
  isMaterialLinkIcon,
  MATERIAL_ALIASES,
} from '../../shared/icons/material.ts'
import catalog from '../../shared/icons/material-names.json' with { type: 'json' }

test('complete pinned xicons Material catalog validates; legacy names retain meaning', () => {
  assert.equal(catalog.length, 10555)
  for (const name of catalog) {
    assert.ok(isMaterialLinkIcon(name), name)
    assert.equal(materialIconName(name), name)
  }
  assert.equal(materialIconName('book'), 'MenuBookRound')
  assert.equal(materialIconName('BookRound'), 'BookRound')
  assert.equal(materialIconName('person'), 'PersonRound')
  assert.ok(Object.values(MATERIAL_ALIASES).every((name) => !/Outline/.test(name)))
  assert.equal(materialIconName('PersonOutlineRound'), 'PersonOutlineRound')
  for (const old of ['book', 'code', 'home', 'person', 'link']) assert.ok(isMaterialLinkIcon(old))
})
test('link schema rejects invalid names, markup, CSS, paths and prototype property names', () => {
  for (const icon of ['ms:rocket_launch', 'ms:favorite', 'menu_book', 'book'])
    assert.ok(LinkSettingsSchema.shape.icon.safeParse(icon).success)
  for (const icon of [
    'ms:not_a_real_symbol_xyz',
    '<svg onload=alert(1)>',
    'url(https://evil.test)',
    '../home',
    'ms:home#id',
    '__proto__',
    'constructor',
    'toString',
    'ms:',
    '',
  ])
    assert.equal(LinkSettingsSchema.shape.icon.safeParse(icon).success, false, icon)
})
