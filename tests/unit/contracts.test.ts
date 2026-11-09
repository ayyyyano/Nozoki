import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createUnconfiguredDashboard,
  defaultModules,
  layoutModules,
  isSafeLink,
} from '../../shared/domain/dashboard.ts'
import { parseAppearance, isHttpsImageUrl } from '../../shared/contracts/appearance.ts'
import { decimalText, signedDecimal } from '../../shared/domain/format.ts'
import { createFixture, SCENARIOS } from '../fixtures/dashboard.ts'

test('default production data has no invented telemetry or quotation history', () => {
  const data = createUnconfiguredDashboard()
  assert.equal(Object.keys(data).length, 8)
  for (const id of ['deepseek', 'devices', 'codex', 'services'] as const) {
    assert.equal(data[id].status, 'unconfigured')
    assert.equal(data[id].data, null)
  }
  assert.deepEqual(
    data.quotes.data?.items.map((q) => q.symbol),
    ['QQQM', 'VOO'],
  )
  for (const quote of data.quotes.data!.items) {
    assert.equal(quote.price, null)
    assert.deepEqual(quote.history, [])
  }
  assert.equal(data.activity.data!.schedule.calendarVersion, null)
})
test('layout removes disabled modules and stably fills their spaces', () => {
  const modules = defaultModules()
  modules[0]!.enabled = false
  modules.find((module) => module.id === 'services')!.sortOrder = -1
  const result = layoutModules(modules)
  assert.equal(result.length, 6)
  assert.equal(result[0]!.id, 'devices')
  assert.equal(result.at(-1)!.id, 'links')
  assert.equal(
    result.some((m) => m.id === 'deepseek'),
    false,
  )
  assert.equal(modules[0]!.id, 'deepseek')
})
test('decimal display preserves exact digits without Number conversion', () => {
  assert.equal(decimalText('1234567890123456.123456'), '1,234,567,890,123,456.123456')
  assert.equal(decimalText('0.00'), '0.00')
  assert.equal(decimalText(null), '—')
  assert.equal(signedDecimal('-0.29'), '-0.29')
  assert.equal(signedDecimal('0'), '+0')
})
test('background preferences reject unsafe URLs and normalize saved values', () => {
  assert.equal(isHttpsImageUrl('http://example.com/x'), false)
  assert.equal(isHttpsImageUrl('https://user:pass@example.com/x'), false)
  assert.equal(isHttpsImageUrl('https://example.com/x.webp'), true)
  const prefs = parseAppearance({
    preset: 'unsafe',
    mode: 'dark',
    background: { x: 500, y: -2, overlay: 'bad', url: 'javascript:alert(1)' },
  })
  assert.equal('preset' in prefs, false)
  assert.equal(prefs.mode, 'dark')
  assert.equal(prefs.background.x, 100)
  assert.equal(prefs.background.y, 0)
  assert.equal(prefs.background.overlay, 20)
  assert.equal(prefs.background.url, '')
})
test('external links reject executable protocols', () => {
  assert.equal(isSafeLink('javascript:alert(1)'), false)
  assert.equal(isSafeLink('https://soki.moe'), true)
})
test('fixture scenarios preserve zero, distinguish down from collection error and do not mutate defaults', () => {
  const edge = createFixture('edge')
  assert.equal(edge.devices.data!.devices[0]!.batteryPercent, 0)
  assert.equal(edge.services.status, 'ok')
  assert.equal(edge.services.data!.monitors[1]!.state, 'down')
  assert.equal(createFixture('error').services.data, null)
  assert.equal(createFixture('stale').devices.status, 'stale')
  for (const scenario of SCENARIOS) assert.equal(Object.keys(createFixture(scenario)).length, 8)
  assert.equal(createUnconfiguredDashboard().devices.data, null)
})
test('upstream empty and failure fixtures preserve independent local navigation', () => {
  const links = createUnconfiguredDashboard().links
  for (const scenario of ['empty', 'error', 'stale', 'unsupported', 'offline'] as const) {
    const fixture = createFixture(scenario)
    assert.deepEqual(fixture.links, links, scenario)
    assert.equal(fixture.services.status, scenario === 'empty' ? 'ok' : scenario)
    if (scenario === 'empty') assert.deepEqual(fixture.services.data?.monitors, [])
    if (scenario === 'error') assert.equal(fixture.services.data, null)
  }
})
