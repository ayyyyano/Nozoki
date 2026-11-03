// Offline HTTP fixtures for layout only. No fixture is written to D1.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, settle, baseURL } from './support.mjs'
import { measure, stable, capture } from './layout-support.mjs'
import { fixed, fixture } from '../fixtures/layout.mjs'
import { createDefaultConfig } from '../../shared/contracts/config.ts'

const before = process.argv.includes('--before')
const directory =
  process.env.LAYOUT_EVIDENCE ?? 'docs/implementation/evidence/phase-07-ui/dynamic-layout'
await mkdir(directory, { recursive: true })
const browser = await launch()
const report = { fixtureOnly: true, engine: browser.version(), before, checks: [], errors: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  await page.addInitScript(() => {
    const Original = window.ResizeObserver
    const targets = new Map()
    window.__layoutObservedCount = () =>
      [...targets.values()].reduce((count, set) => count + set.size, 0)
    window.ResizeObserver = class extends Original {
      observe(target, options) {
        if (target.matches('.dashboard-grid, .dashboard-grid > [data-module]')) {
          const set = targets.get(this) ?? new Set()
          set.add(target)
          targets.set(this, set)
        }
        super.observe(target, options)
      }
      unobserve(target) {
        targets.get(this)?.delete(target)
        super.unobserve(target)
      }
      disconnect() {
        targets.delete(this)
        super.disconnect()
      }
    }
  })
  await page.clock.setFixedTime(fixed)
  page.on('pageerror', (error) => report.errors.push(error.message))
  let current = await fixture({ guest: true, stale: true, longNames: true })
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
  await page.goto(baseURL)
  await settle(page)
  if (before) {
    const css = execFileSync('git', ['show', 'HEAD:app/assets/styles/dashboard.css'], {
      encoding: 'utf8',
    })
    await page.addStyleTag({
      content:
        css +
        `
      .dashboard-grid[data-packed] {row-gap:16px;margin-bottom:0}
      .link-grid {align-items:stretch}
      .quote-title > span {white-space:normal;overflow:visible;text-overflow:clip}
      @media(max-width:650px){.dashboard-grid[data-packed]{row-gap:12px}}
    `,
    })
  }
  await page.evaluate(() => {
    const marker = document.createElement('aside')
    marker.textContent = '离线测试夹具 · 非真实行情或设备数据'
    marker.style.cssText =
      'position:fixed;bottom:0;left:0;z-index:9999;background:#222;color:white;font:12px system-ui;padding:4px 8px;pointer-events:none'
    document.body.append(marker)
  })
  async function show(name, options, width = 1440, height = 900, screenshot = false) {
    current = await fixture(options)
    await page.setViewportSize({ width, height })
    const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    await page.waitForTimeout(100)
    await stable(page)
    const geometry = await measure(page)
    geometry.name = name
    geometry.expectedOrder = current.modules.map((m) => m.id)
    if (!before) {
      assert.ok(geometry.pageWidth <= width, JSON.stringify(geometry))
      assert.deepEqual(geometry.domOrder, geometry.expectedOrder)
      assert.deepEqual(geometry.visualOrder, geometry.domOrder)
      for (const card of geometry.cards) {
        assert.ok(card.scrollWidth <= card.clientWidth + 1, JSON.stringify(card))
        assert.ok(card.x >= 0 && card.right <= width + 1, JSON.stringify(card))
      }
      for (let i = 0; i < geometry.cards.length; i++)
        for (const b of geometry.cards.slice(i + 1)) {
          const a = geometry.cards[i]
          assert.ok(
            a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1,
            JSON.stringify({ a, b }),
          )
        }
      for (const q of geometry.quotes) assert.ok(q.chartWidth <= q.width + 1, JSON.stringify(q))
    }
    report.checks.push(geometry)
    if (screenshot)
      await capture(page, `${directory}/${before ? 'before' : 'after'}-${name}-${width}.png`)
    return geometry
  }
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [360, 800],
    [320, 700],
  ]) {
    const g = await show(
      'guest-stale',
      { guest: true, stale: true, longNames: true },
      width,
      height,
      true,
    )
    if (!before && width >= 1024)
      assert.equal(g.quotes[0].y, g.quotes[1].y, JSON.stringify(g.quotes))
  }
  if (!before) {
    const empty = await show('unconfigured', { empty: true }, 1440, 900, true)
    assert.ok(Math.abs(empty.cards.at(-1).bottom - 876) <= 2, JSON.stringify(empty))
    const compact = await show('quotes-four', { guest: true, quotes: 4 }, 1440, 900, true)
    const activity = compact.cards.find((c) => c.id === 'activity')
    assert.ok(activity.height < compact.cards.find((c) => c.id === 'quotes').height)
    assert.equal(compact.quotes[0].y, compact.quotes[1].y)
    assert.equal(compact.quotes[2].y, compact.quotes[3].y)
    const sibling = compact.quotes[1].height
    await page.locator('.quote-extra summary').first().click()
    await stable(page)
    const opened = await measure(page)
    assert.equal(opened.quotes[1].height, sibling)
    assert.equal(await page.locator('.quote-extra[open]').count(), 1)
    assert.equal(opened.cards.find((c) => c.id === 'activity').height, activity.height)
    await capture(page, `${directory}/after-detail-open-1440.png`)
    report.checks.push({ name: 'independent-detail', ...opened })
    const long = await show('long-activity', { guest: true, longActivity: true }, 1440, 900, true)
    assert.ok(
      long.cards.find((c) => c.id === 'activity').height >
        long.cards.find((c) => c.id === 'quotes').height,
    )
    const devices = await show(
      'many-devices-links',
      { devices: 20, links: 9, quotes: 3, disabled: [] },
      1280,
      720,
      true,
    )
    assert.ok(devices.cards.find((c) => c.id === 'devices').height > 600)
    const single = await show('one-quote', { quotes: 1 }, 1440, 900, true)
    assert.ok(single.quotes[0].width >= single.quoteWidth - 44)
    await show('four-mobile', { quotes: 4, links: 7, devices: 10, longNames: true }, 320, 700, true)
    const reversed = [...createDefaultConfig().modules.map((m) => m.id)].reverse()
    await show('reordered', { order: reversed, disabled: ['devices', 'deepseek'] }, 1440, 900, true)
    await show(
      'reordered-mobile',
      { order: reversed, disabled: ['activity', 'tailscale'] },
      390,
      844,
    )
    await show('disabled', { disabled: ['tailscale', 'activity', 'quotes', 'devices'] }, 1024, 768)
    await show('keyboard', { guest: true }, 1440, 900)
    await page.evaluate(() => {
      document.body.tabIndex = -1
      document.body.focus()
    })
    let priorIndex = -1
    const keyboardModules = []
    for (let i = 0; i < 35; i++) {
      await page.keyboard.press('Tab')
      const id = await page.evaluate(
        () => document.activeElement?.closest('[data-module]')?.getAttribute('data-module') ?? null,
      )
      if (!id) continue
      const index = current.modules.findIndex((m) => m.id === id)
      if (index < priorIndex && id === current.modules[0].id) break
      assert.ok(index >= priorIndex, JSON.stringify({ id, index, priorIndex }))
      priorIndex = index
      if (keyboardModules.at(-1) !== id) keyboardModules.push(id)
    }
    assert.ok(keyboardModules.includes('quotes') && keyboardModules.includes('links'))
    report.checks.push({ name: 'keyboard-dom-order', modules: keyboardModules })
    await page.getByRole('button', { name: '切换到亮色模式', exact: true }).click()
    await page.waitForTimeout(200)
    await show('light', { guest: true, stale: true }, 1440, 900, true)
    // An embedded panel has less space than the viewport.
    await page.addStyleTag({ content: '.dashboard-grid-container{max-width:620px}' })
    const embedded = await show('embedded-620', { guest: true }, 1280, 800, true)
    assert.equal(new Set(embedded.cards.map((c) => Math.round(c.x))).size, 1)
    await page.addStyleTag({ content: '.dashboard-grid-container{max-width:320px}' })
    const narrowPanel = await show('embedded-320', { quotes: 4, longNames: true }, 1280, 800, true)
    assert.equal(narrowPanel.grid.width, 320)
    const observed = await page.evaluate(() => window.__layoutObservedCount())
    assert.equal(observed, current.modules.length + 1)
    await page.evaluate(() =>
      document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push('/login'),
    )
    await page.waitForFunction(
      () => !document.querySelector('.dashboard-grid') && window.__layoutObservedCount() === 0,
    )
    await page.evaluate(() =>
      document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push('/'),
    )
    await settle(page)
    await page.waitForFunction(() => document.querySelector('.dashboard-grid[data-packed="true"]'))
    assert.equal(await page.evaluate(() => window.__layoutObservedCount()), observed)
    report.checks.push({ name: 'observer-unmount-remount', targets: observed, afterUnmount: 0 })
    // With observation unavailable, the SSR/native Grid fallback stays readable.
    const fallback = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    await fallback.addInitScript(() => {
      window.ResizeObserver = undefined
    })
    await fallback.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
    await fallback.goto(baseURL)
    await settle(fallback)
    const refreshed = fallback.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await fallback.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    await fallback.waitForTimeout(100)
    const fallbackGeometry = await measure(fallback)
    assert.ok(fallbackGeometry.pageWidth <= 1024)
    assert.equal(await fallback.locator('.dashboard-grid[data-packed]').count(), 0)
    report.checks.push({ name: 'no-resize-observer', ...fallbackGeometry })
    await fallback.close()
    assert.deepEqual(report.errors, [])
  }
} finally {
  await browser.close()
  await writeFile(
    `${directory}/${before ? 'before' : 'after'}-measurements.json`,
    JSON.stringify(report, null, 2),
  )
}
console.log(
  JSON.stringify({
    fixtureOnly: true,
    before,
    checks: report.checks.length,
    errors: report.errors,
  }),
)
