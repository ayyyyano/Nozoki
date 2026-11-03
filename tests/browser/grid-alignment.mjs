import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { launch, settle, baseURL } from './support.mjs'
import { capture, measure, stable } from './layout-support.mjs'
import { fixture, fixed } from '../fixtures/layout.mjs'
import { createDefaultConfig } from '../../shared/contracts/config.ts'

const require = createRequire(import.meta.url)
const playwrightRequire = createRequire(require.resolve('playwright/package.json'))
// Use the PNG reader already bundled with the pinned Playwright test dependency.
const { PNG } = require(
  resolve(dirname(playwrightRequire.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'),
)
const directory =
  process.env.ALIGNMENT_EVIDENCE ??
  'docs/implementation/evidence/phase-07-ui/alignment-background/after'
await mkdir(directory, { recursive: true })
const browser = await launch()
const report = {
  fixtureOnly: true,
  engine: browser.version(),
  checks: [],
  scrollChecks: [],
  errors: [],
}
const ids = createDefaultConfig().modules.map((m) => m.id)
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  await page.clock.setFixedTime(fixed)
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (
      ['error', 'warning'].includes(message.type()) &&
      /hydration|ResizeObserver loop/i.test(message.text())
    )
      report.errors.push(message.text())
  })
  let current = await fixture({ guest: true })
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
  const wallpaper = await readFile('public/media/wallpaper-glass-picnic.webp')
  await page.route('https://images.example.invalid/layout-fixture.webp', (route) =>
    route.fulfill({ body: wallpaper, contentType: 'image/webp' }),
  )
  await page.goto(baseURL)
  await settle(page)
  await page.evaluate(() => {
    const marker = document.createElement('aside')
    marker.textContent = '离线布局夹具 · 非真实行情或设备数据'
    marker.style.cssText =
      'position:fixed;bottom:0;left:0;z-index:9999;background:#222;color:white;font:12px system-ui;padding:4px 8px;pointer-events:none'
    document.body.append(marker)
  })
  async function show(name, options = {}, width = 1440, height = 900, screenshot = false) {
    await page.evaluate(() => {
      document.querySelector('[data-layout-test]')?.remove()
      scrollTo(0, 0)
    })
    current = await fixture(options)
    await page.setViewportSize({ width, height })
    const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    await page.waitForTimeout(100)
    await stable(page)
    const g = await measure(page)
    assertGeometry(
      g,
      current.modules.map((m) => m.id),
    )
    report.checks.push({ name, ...g })
    if (screenshot) await capture(page, `${directory}/${name}-${width}.png`)
    return g
  }
  function assertGeometry(g, expected) {
    assert.deepEqual(g.domOrder, expected)
    assert.deepEqual(g.visualOrder, expected)
    assert.ok(g.pageWidth <= g.width, JSON.stringify(g))
    assert.equal(g.gridFlow, 'row')
    assert.ok(
      g.topBaseline.every((y) => Math.abs(y - g.grid.y) < 1),
      JSON.stringify(g.topBaseline),
    )
    for (const gap of g.columnGaps)
      assert.ok(
        gap.gap >= g.expectedGap - 0.1 && gap.gap <= g.expectedGap + 1.1,
        JSON.stringify(gap),
      )
    for (const card of g.cards) {
      assert.ok(card.x >= 0 && card.right <= g.width + 1, JSON.stringify(card))
      assert.ok(card.scrollWidth <= card.clientWidth + 1, JSON.stringify(card))
      assert.ok(Math.abs(card.width - g.cards[0].width) < 1, JSON.stringify(g.cards))
      assert.ok(card.surfaceGrowth <= Math.min(120, (card.height - card.surfaceGrowth) / 2) + 0.1)
    }
    for (let i = 0; i < g.cards.length; i++)
      for (const b of g.cards.slice(i + 1)) {
        const a = g.cards[i]
        assert.ok(
          a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1,
          JSON.stringify({ a, b }),
        )
      }
    for (const quote of g.quotes) assert.ok(quote.chartWidth <= quote.width + 1)
    assert.ok(
      g.bottomPadding >= 23 &&
        ((g.pageHeight <= g.height + 1 && g.width <= 1100) || g.bottomPadding <= 25.1),
      JSON.stringify({ bottomPadding: g.bottomPadding, width: g.width, pageHeight: g.pageHeight }),
    )
  }
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [768, 1024],
    [600, 900],
    [390, 844],
    [320, 700],
  ]) {
    const g = await show(
      'seven-stale',
      { guest: true, quotes: 2, stale: true, longNames: true },
      width,
      height,
      true,
    )
    if (width >= 1024) assert.equal(g.quotes[0].y, g.quotes[1].y)
    if (width === 1440 || width === 1280) {
      const activity = g.cards.find((c) => c.id === 'activity')
      const quotes = g.cards.find((c) => c.id === 'quotes')
      assert.equal(activity.y, quotes.y)
      assert.equal(activity.headingY, quotes.headingY)
    }
    if (width === 1440 || width === 1280 || width === 768) {
      assert.ok(Math.max(...g.columnEnds) - Math.min(...g.columnEnds) <= 1.1)
    }
    if (width === 768) assert.ok(g.cards.find((c) => c.id === 'links').rowGrowth > 0)
    if (width <= 600) assert.equal(g.columnCount, 1)
    if (width <= 600) assert.ok(g.cards.every((c) => c.rowGrowth === 0 && c.surfaceGrowth === 0))
  }
  const fitted = await show('three-column-detail-baseline', { guest: true, stale: true }, 1440, 900)
  await page.locator('.quote-extra summary').first().click()
  await stable(page)
  const expanded = await measure(page)
  assertGeometry(expanded, fitted.domOrder)
  for (const id of ['activity', 'links', 'services'])
    assert.equal(
      expanded.cards.find((c) => c.id === id).height,
      fitted.cards.find((c) => c.id === id).height,
    )
  assert.equal(expanded.quotes[1].height, fitted.quotes[1].height)
  report.checks.push({ name: 'three-column-detail-no-unrelated-growth', ...expanded })
  await capture(page, `${directory}/three-column-detail-open-1440.png`)
  await page.locator('.quote-extra summary').first().click()
  await stable(page)
  const two = await show(
    'two-hints',
    { guest: true, loginOnly: true, only: ['deepseek', 'services'] },
    1440,
    900,
    true,
  )
  assert.equal(two.cards.length, 2)
  assert.equal(two.columnCount, 2)
  assert.equal(two.cards[0].y, two.cards[1].y)
  assert.ok(two.cards.every((c) => c.height < 150))
  await show('four-modules', { only: ['devices', 'quotes', 'links', 'services'] }, 1440, 900, true)
  const eight = await show(
    'eight-custom-titles',
    { disabled: [], customTitles: true, monitors: 8 },
    1440,
    900,
    true,
  )
  assert.equal(eight.cards.length, 8)
  await page.evaluate(() => {
    const card = document.createElement('section')
    card.dataset.module = 'fixture-ninth'
    card.dataset.layoutTest = 'true'
    card.className = 'module-card'
    const title = document.createElement('h2')
    title.textContent = '第九个布局测试模块'
    const body = document.createElement('p')
    body.textContent = '仅用于离线布局验证。'.repeat(8)
    card.append(title, body)
    document.querySelector('.dashboard-grid').children[3].before(card)
  })
  await stable(page)
  const nine = await measure(page)
  const expectedNine = [...eight.domOrder]
  expectedNine.splice(3, 0, 'fixture-ninth')
  assertGeometry(nine, expectedNine)
  report.checks.push({ name: 'ninth-test-only-module', ...nine })
  await capture(page, `${directory}/nine-modules-1440.png`)
  await show('middle-disabled', { disabled: ['tailscale', 'activity'] }, 768, 1024, true)
  await show(
    'reordered',
    { disabled: [], order: [...ids].reverse(), customTitles: true },
    1440,
    900,
    true,
  )
  await show('many-devices', { devices: 18, disabled: [] }, 1280, 800, true)
  const monitors = await show('many-monitors', { monitors: 16, longNames: true }, 1024, 768, true)
  assert.ok(monitors.cards.find((c) => c.id === 'services').height > 600)
  const activity = await show(
    'long-activity',
    { guest: true, longActivity: true, quotes: 1 },
    1440,
    900,
    true,
  )
  assert.ok(
    activity.cards.find((c) => c.id === 'activity').height >
      activity.cards.find((c) => c.id === 'quotes').height,
  )
  assert.equal(activity.cards.find((c) => c.id === 'links').rowGrowth, 0)
  const quotes = await show('long-quotes', { guest: true, quotes: 4, links: 8 }, 1440, 900, true)
  await page.locator('.quote-extra summary').first().click()
  await stable(page)
  const opened = await measure(page)
  assertGeometry(opened, quotes.domOrder)
  assert.equal(
    opened.cards.find((c) => c.id === 'activity').height,
    quotes.cards.find((c) => c.id === 'activity').height,
  )
  assert.equal(opened.quotes[1].height, quotes.quotes[1].height)
  report.checks.push({ name: 'independent-expanded-detail', ...opened })
  await show('unconfigured', { empty: true }, 1440, 900, true)
  await show('all-login-hints', { guest: true, loginOnly: true }, 768, 1024, true)

  function strip(image, offset = 0) {
    const pixels = []
    for (let y = 150; y < 450; y++)
      for (let x = 2; x < 9; x++) {
        const at = ((y + offset) * image.width + x) * 4
        pixels.push(image.data[at], image.data[at + 1], image.data[at + 2])
      }
    return pixels
  }
  const difference = (a, b) => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0)
  for (const width of [320, 390]) {
    await show('wallpaper-scroll', { guest: true, quotes: 4, links: 8, stale: true }, width, 700)
    await page.waitForFunction(
      () => document.querySelector('.background-scene.loaded img')?.complete,
    )
    let topPixels
    for (const [part, selector, fraction] of [
      ['top', null, 0],
      ['activity', '[data-module="activity"]', 0],
      ['quotes', '[data-module="quotes"]', 0.5],
      ['bottom', null, 1],
    ]) {
      await page.evaluate(
        ({ selector, fraction }) => {
          const card = selector && document.querySelector(selector)
          const y = card
            ? scrollY +
              card.getBoundingClientRect().top +
              card.getBoundingClientRect().height * fraction -
              70
            : fraction
              ? document.documentElement.scrollHeight - innerHeight
              : 0
          scrollTo(0, y)
        },
        { selector, fraction },
      )
      await page.waitForTimeout(80)
      const info = await page.evaluate(() => {
        const bg = document.querySelector('.background-scene'),
          img = bg.querySelector('img'),
          r = bg.getBoundingClientRect()
        return {
          scrollY,
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: innerHeight,
          bg: { top: r.top, bottom: r.bottom, height: r.height, width: r.width },
          position: getComputedStyle(bg).position,
          image: {
            naturalWidth: img.naturalWidth,
            opacity: getComputedStyle(img).opacity,
            fit: getComputedStyle(img).objectFit,
            position: getComputedStyle(img).objectPosition,
          },
        }
      })
      const bytes = await page.screenshot({
        path: `${directory}/wallpaper-${width}-${part}-viewport.png`,
      })
      const pixels = strip(PNG.sync.read(bytes))
      if (!topPixels) topPixels = pixels
      const delta = difference(topPixels, pixels)
      assert.ok(delta <= 2, JSON.stringify({ width, part, delta }))
      assert.equal(info.position, 'fixed')
      assert.equal(info.bg.top, 0)
      assert.equal(info.bg.height, 700)
      assert.equal(info.image.opacity, '1')
      assert.equal(info.image.fit, 'cover')
      assert.equal(info.image.position, '50% 35%')
      report.scrollChecks.push({ width, part, maxPixelDifferenceFromTop: delta, ...info })
    }
    await page.setViewportSize({ width, height: 640 })
    await page.waitForTimeout(100)
    assert.equal(
      await page.locator('.background-scene').evaluate((e) => e.getBoundingClientRect().height),
      640,
    )
    await page.setViewportSize({ width, height: 700 })
    await page.evaluate(() => scrollTo(0, 0))
    const full = PNG.sync.read(
      await page.screenshot({
        path: `${directory}/wallpaper-${width}-fullpage-reference.png`,
        fullPage: true,
      }),
    )
    report.scrollChecks.push({
      width,
      part: 'fullpage-diagnostic',
      height: full.height,
      maxDifferenceFromViewportAt850: difference(topPixels, strip(full, 700)),
      note: 'FullPage reference only; wallpaper correctness uses real scrolled viewport images.',
    })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '显示纯壁纸', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.nozoki-app').dataset.displayMode === 'wallpaper',
  )
  assert.equal(await page.locator('.dashboard-grid').isVisible(), false)
  assert.equal(await page.locator('.background-scene img').isVisible(), true)
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
  await page.screenshot({ path: `${directory}/wallpaper-only-390.png` })
  await page.getByRole('button', { name: '恢复看板', exact: true }).click()
  await stable(page)
  assertGeometry(
    await measure(page),
    current.modules.map((m) => m.id),
  )
  report.checks.push({ name: 'wallpaper-toggle-restore', passed: true })

  for (const mode of ['banner', 'off', 'custom'])
    for (const theme of ['dark', 'light']) {
      const button = page.getByRole('button', {
        name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式',
        exact: true,
      })
      if (await button.count()) await button.click()
      const background =
        mode === 'banner'
          ? { layout: 'banner' }
          : mode === 'off'
            ? { source: 'off' }
            : {
                source: 'custom',
                layout: 'page',
                url: 'https://images.example.invalid/layout-fixture.webp',
              }
      await show(
        `${mode}-${theme}`,
        { guest: true, quotes: 4, links: 6, background },
        390,
        844,
        true,
      )
      if (mode === 'off') assert.equal(await page.locator('.background-scene').count(), 0)
      else {
        await page.waitForFunction(
          () => document.querySelector('.background-scene.loaded img')?.naturalWidth > 0,
        )
        assert.equal(
          await page.locator('.background-scene').evaluate((e) => getComputedStyle(e).position),
          mode === 'banner' ? 'relative' : 'fixed',
        )
      }
    }
  assert.deepEqual(report.errors, [])
} finally {
  await browser.close()
  await writeFile(`${directory}/measurements.json`, JSON.stringify(report, null, 2))
}
console.log(
  JSON.stringify({
    fixtureOnly: true,
    alignmentChecks: report.checks.length,
    scrollChecks: report.scrollChecks.length,
    errors: report.errors,
  }),
)
