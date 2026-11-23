// Isolated public DTO fixtures; this test does not collect or persist upstream data.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { expect } from 'playwright/test'
import { fixture, fixed } from '../fixtures/layout.ts'
import { balanceDays } from '../../shared/domain/daily-balances.ts'
import { dashboardPlan } from '../../shared/domain/module-layout.ts'
import { settle } from './support.ts'
import { stable, measure, capture } from './layout-support.ts'

export async function exerciseCompactGrid(page, { origin, evidence }) {
  assert.ok(
    relative(resolve('.'), resolve(evidence)).startsWith('..'),
    'Evidence outside checkout only',
  )
  await mkdir(evidence, { recursive: true })
  const before = process.env.NOZOKI_COMPACT_BEFORE === '1'
  const prefix = before ? 'before' : 'after'
  await page.clock.setFixedTime(fixed)
  const full = await fixture({ devices: 7, monitors: 12, disabled: [], stale: true })
  // The widest percentage must fit alongside the charging indicator.
  full.modules.find((m) => m.id === 'devices').snapshot.data.devices[1].batteryPercent = 100
  for (const id of ['codex', 'tailscale']) {
    const m = full.modules.find((m) => m.id === id)
    m.snapshot = {
      ...m.snapshot,
      status: 'unconfigured',
      data: null,
      sourceConfigured: false,
      collectedAt: null,
      observedAt: null,
      lastSuccessAt: null,
      expiresAt: null,
    }
  }
  const balance = full.modules.find((m) => m.id === 'deepseek').snapshot
  balance.data.balances = balance.data.balances.filter((b) => b.currency === 'CNY')
  balance.data.dailyBalances = balanceDays(fixed, 'Asia/Shanghai').map(({ day }, i) => ({
    day,
    currency: 'CNY',
    total: String(100 - i),
    collectedAt: fixed.toISOString(),
  }))
  let current = full
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
  await page.goto(origin)
  await settle(page)
  const report = []
  let fixtureRestore
  async function render(count, mode, links = true, linkCount = 4) {
    if (fixtureRestore) {
      await page.evaluate((original) => {
        document.querySelector('.dashboard-grid').replaceWith(original)
      }, fixtureRestore)
      await fixtureRestore.dispose()
      fixtureRestore = undefined
    }
    const selected = [
      'deepseek',
      'devices',
      'activity',
      'quotes',
      'services',
      'codex',
      'tailscale',
    ].slice(0, Math.min(count, 7))
    current = structuredClone(full)
    current.site.background.layout = mode === 'banner' ? 'banner' : 'page'
    current.site.background.source = mode === 'off' ? 'off' : 'builtin'
    current.modules = current.modules.filter(
      (m) => selected.includes(m.id) || (links && m.id === 'links'),
    )
    const navigation = current.modules.find((m) => m.id === 'links')
    if (navigation)
      navigation.snapshot.data.items = navigation.snapshot.data.items.slice(0, linkCount)
    const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await response
    await expect(page.locator('.dashboard-grid > [data-module]')).toHaveCount(
      selected.length + Number(links),
    )
    await expect(page.locator('.nozoki-app')).toHaveAttribute('data-background-layout', mode)
    await stable(page)
    if (count > 7) {
      const plans = [
        dashboardPlan(count, 2, links),
        dashboardPlan(count, 3, links, 'strip-single-tail'),
        dashboardPlan(count, 3, links),
        dashboardPlan(count, 4, links),
      ]
      fixtureRestore = await page.evaluateHandle(
        ({ count, plans }) => {
          // Fixture-only modules have no DTO. Use a detached copy so Vue cannot reset its spans.
          const original = document.querySelector('.dashboard-grid')
          const grid = original.cloneNode(true)
          const realCount = grid.querySelectorAll('[data-layout-role="business"]').length
          const card = grid.querySelector('[data-module="codex"]')
          const navigation = grid.querySelector('[data-layout-role="navigation"]')
          for (let i = realCount; i < count; i++) {
            const extra = card.cloneNode(true)
            const id = `future-fixture-${i}`
            extra.setAttribute('data-module', id)
            extra.querySelector('h2').textContent = '未来业务模块'
            extra.querySelector('h2').id = `${id}-title`
            extra.setAttribute('aria-labelledby', `${id}-title`)
            grid.insertBefore(extra, navigation)
          }
          grid.dataset.businessCount = String(count)
          grid.dataset.mediumLinks = plans[0].links
          grid.dataset.compactWideLinks = plans[1].links
          grid.dataset.wideLinks = plans[2].links
          grid.dataset.expandedLinks = plans[3].links
          for (const [index, key] of ['medium', 'compact-wide', 'wide', 'expanded'].entries()) {
            grid.style.setProperty(`--${key}-links-span`, String(plans[index].linksSpan))
            grid
              .querySelectorAll('[data-layout-role="business"]')
              .forEach((el, i) =>
                el.style.setProperty(`--${key}-span`, String(plans[index].businessSpans[i])),
              )
          }
          original.replaceWith(grid)
          return original
        },
        { count, plans },
      )
      await stable(page)
    }
  }
  async function inspect(label) {
    const m = await measure(page)
    const details = await page.evaluate(() => {
      const box = (e) => {
        if (!e) return null
        const r = e.getBoundingClientRect()
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right,
        }
      }
      const main = document.querySelector('.dashboard-container')
      const cards = [...document.querySelectorAll('.dashboard-grid > .module-card')].map((el) => {
        const r = el.getBoundingClientRect()
        // Measure natural summary size separately, without the fixed card or body flex growth.
        const copy = el.cloneNode(true)
        copy.style.cssText += `;position:absolute;visibility:hidden;width:${r.width}px;height:auto!important;min-height:0!important;`
        copy.querySelector('.module-body').style.flex = '0 0 auto'
        el.parentElement.append(copy)
        const natural = copy.getBoundingClientRect().height
        copy.remove()
        const body = el.querySelector('.module-body')
        const header = el.querySelector('.module-header'),
          footer = el.querySelector('footer')
        const children = [...body.children].map(box)
        return {
          id: el.dataset.module,
          ...box(el),
          natural,
          body: box(body),
          header: box(header),
          footer: box(footer),
          contentBottom: Math.max(
            box(header).bottom,
            ...children.map((r) => r.bottom),
            footer ? box(footer).bottom : 0,
          ),
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          padding: parseFloat(getComputedStyle(el).paddingBottom),
          bodyFlex: getComputedStyle(body).flex,
          bodyOverflow: getComputedStyle(body).overflow,
          text: body.innerText,
        }
      })
      const grid = document.querySelector('.dashboard-grid')
      const gridStyle = getComputedStyle(grid)
      const columns = gridStyle.gridTemplateColumns.split(' ').length
      const navigation = grid.querySelector('[data-layout-role="navigation"]')
      const linkGrid = navigation?.querySelector('.link-grid')
      const rowBoundaries = Object.values(
        [...grid.children].reduce((rows, el) => {
          const r = box(el),
            key = Math.round(r.y)
          const row = (rows[key] ??= {
            top: r.y,
            left: r.x,
            right: r.right,
            bottom: r.bottom,
            items: [],
          })
          row.left = Math.min(row.left, r.x)
          row.right = Math.max(row.right, r.right)
          row.bottom = Math.max(row.bottom, r.bottom)
          row.items.push({ id: el.dataset.module, ...r })
          return rows
        }, {}),
      )
      return {
        banner: box(document.querySelector('.background-scene.banner')),
        wave: box(document.querySelector('.banner-wave')),
        buttons: box(document.querySelector('.page-actions')),
        main: box(main),
        padding: {
          top: parseFloat(getComputedStyle(main).paddingTop),
          bottom: parseFloat(getComputedStyle(main).paddingBottom),
        },
        pageClientHeight: document.documentElement.clientHeight,
        scroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        rows: gridStyle.gridTemplateRows.split(' ').filter((n) => parseFloat(n) > 0).length,
        rowBoundaries,
        navigation: navigation && {
          ...box(navigation),
          start: getComputedStyle(navigation).gridColumnStart,
          end: getComputedStyle(navigation).gridColumnEnd,
          align: getComputedStyle(navigation).alignSelf,
          columns: linkGrid
            ? getComputedStyle(linkGrid).gridTemplateColumns.split(' ').length
            : null,
          leadingSpace: linkGrid?.firstElementChild
            ? box(linkGrid.firstElementChild).y - box(navigation).y
            : null,
          items: linkGrid ? [...linkGrid.children].map(box) : [],
        },
        minCardWidth: Math.min(...cards.map((c) => c.width)),
        columns,
        rootOverflow: getComputedStyle(document.documentElement).overflowY,
        devicesColumns:
          document.querySelector('.device-list') &&
          getComputedStyle(document.querySelector('.device-list')).gridTemplateColumns,
        serviceColumns:
          document.querySelector('.monitor-list') &&
          getComputedStyle(document.querySelector('.monitor-list')).gridTemplateColumns,
        cards,
      }
    })
    const result = { label, ...m, ...details }
    report.push(result)
    await writeFile(
      resolve(evidence, prefix + '-measurements.json'),
      JSON.stringify(report, null, 2),
    )
    if (!before) {
      assert.ok(m.pageWidth <= m.clientWidth, label)
      assert.deepEqual(m.domOrder, m.visualOrder)
      for (const [index, row] of details.rowBoundaries.entries()) {
        const width = (m.grid.width - (row.items.length - 1) * m.expectedGap) / row.items.length
        assert.ok(Math.abs(row.left - m.grid.x) < 1, `${label}: row ${index + 1} left edge`)
        assert.ok(Math.abs(row.right - m.grid.right) < 1, `${label}: row ${index + 1} right edge`)
        if (index > 0)
          assert.ok(
            Math.abs(row.top - details.rowBoundaries[index - 1].bottom - m.expectedGap) < 1,
            `${label}: row ${index + 1} gap`,
          )
        for (const [i, item] of row.items.entries()) {
          assert.ok(Math.abs(item.width - width) < 1, `${label}: ${item.id} width`)
          assert.ok(
            Math.abs(item.x - m.grid.x - i * (width + m.expectedGap)) < 1,
            `${label}: ${item.id} gap`,
          )
        }
      }
      for (const c of details.cards) {
        assert.ok(c.scrollHeight <= c.clientHeight + 1, JSON.stringify(c))
        assert.ok(c.scrollWidth <= c.clientWidth + 1, JSON.stringify(c))
        assert.ok(c.contentBottom <= c.bottom - c.padding + 1, JSON.stringify(c))
        assert.notEqual(c.bodyOverflow, 'hidden')
      }
      assert.notEqual(details.rootOverflow, 'hidden')
    }
    return result
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const count of [5, 7])
    for (const mode of ['page', 'banner']) {
      await render(count, mode)
      const result = await inspect(`${count}-${mode}-1440x900`)
      await capture(page, resolve(evidence, `${prefix}-${count}-${mode}-1440.png`))
      await page.screenshot({
        path: resolve(evidence, `${prefix}-${count}-${mode}-1440-full.png`),
        fullPage: true,
      })
      if (!before) {
        assert.equal(result.scroll, 0, JSON.stringify(result))
        assert.equal(result.columnCount, count === 7 ? 4 : 3)
        assert.equal(result.rows, 2)
        assert.ok(result.cards.every((c) => Math.abs(c.height - result.cards[0].height) < 1))
        assert.ok(result.cards.every((c) => c.height === 240))
        assert.equal(result.devicesColumns.split(' ').length, 2)
        assert.equal(result.serviceColumns.split(' ').length, 2)
        assert.equal(result.quoteColumns.split(' ').length, 2)
        if (count === 7) assert.ok(result.minCardWidth >= 320)
        for (const id of ['deepseek', 'devices', 'quotes', 'services']) {
          await expect(page.locator(`[data-module="${id}"]`)).not.toContainText('已过期')
          await expect(
            page.locator(`[data-module="${id}"] .module-body > .data-state`),
          ).toHaveCount(0)
        }
        await expect(page.locator('[data-module="services"] .monitor-row')).toHaveCount(8)
        await expect(
          page.locator('[data-module="services"] footer').getByRole('status', {
            name: '全部监控状态',
          }),
        ).toContainText('待确认 12')
        await expect(
          page.locator('[data-module="services"] .module-body').getByRole('status', {
            name: '全部监控状态',
          }),
        ).toHaveCount(0)
        await expect(page.locator('[data-module="devices"] .device-row')).toHaveCount(4)
        assert.ok(result.quotes.every((q) => q.chartWidth >= 120))
      }
    }
  if (before) return
  const quotePlot = () =>
    page.locator('[data-module="quotes"] .module-body polyline').evaluateAll((lines) =>
      lines.map((line) => {
        const r = line.getBoundingClientRect()
        return { width: r.width, height: r.height }
      }),
    )
  const compactPlot = await quotePlot()
  const compactQuotes = await inspect('quotes-compact')
  const oldQuoteSpacing = await page.addStyleTag({
    content: '.module-body .quote-price {margin:6px 0 2px} .module-body .quote-chart {height:44px}',
  })
  const previousQuotes = await inspect('quotes-previous-density')
  const previousPlot = await quotePlot()
  assert.ok(
    previousQuotes.cards.find((c) => c.id === 'quotes').natural -
      compactQuotes.cards.find((c) => c.id === 'quotes').natural >=
      10,
  )
  // At four-column widths the plot is limited by its width; removing vertical letterboxing
  // must not shrink the drawn trend, even though its outer SVG container is shorter.
  compactPlot.forEach((plot, i) => {
    assert.ok(Math.abs(plot.width - previousPlot[i].width) < 1)
    assert.ok(Math.abs(plot.height - previousPlot[i].height) < 1)
  })
  await oldQuoteSpacing.evaluate((el) => el.remove())
  for (const height of [240, 242, 256, 260, 280]) {
    const style = await page.addStyleTag({
      content: `.dashboard-grid { --business-card-height: ${height}px !important; }`,
    })
    await render(7, 'banner')
    await inspect(`candidate-${height}`)
    await style.evaluate((el) => el.remove())
  }
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1440, 720],
    [1391, 900],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height })
    for (const mode of ['page', 'banner', 'off'])
      for (const [count, links] of [
        [4, true],
        [5, true],
        [6, true],
        [7, true],
        [7, false],
        [8, true],
      ]) {
        await render(count, mode, links)
        const result = await inspect(`${width}x${height}-${mode}-${count}-${links}`)
        if (result.grid.width >= 1328 && count === 7) assert.equal(result.columnCount, 4)
        if (result.grid.width >= 1328 && count === 7) {
          const batteries = await page
            .locator('[data-module="devices"] .module-body .battery-value:has(.device-charging)')
            .evaluateAll((nodes) =>
              nodes.map((node) => {
                const children = [...node.children].map((el) => el.getBoundingClientRect())
                const icon = node.querySelector('.device-charging svg').getBoundingClientRect()
                return {
                  height: node.getBoundingClientRect().height,
                  readingHeight: node.querySelector('strong').getBoundingClientRect().height,
                  centers: children.map((r) => (r.top + r.bottom) / 2),
                  iconWidth: icon.width,
                  iconHeight: icon.height,
                }
              }),
            )
          assert.ok(batteries.length > 0)
          for (const battery of batteries) {
            assert.ok(battery.height <= battery.readingHeight + 1, JSON.stringify(battery))
            assert.ok(Math.max(...battery.centers) - Math.min(...battery.centers) < 1)
            assert.equal(battery.iconWidth, 14)
            assert.equal(battery.iconHeight, 14)
          }
        }
        if (width >= 1280 && count <= 7) assert.ok(result.quoteColumns.split(' ').length === 2)
        if (width >= 1440 && height >= 900 && count <= 7)
          assert.equal(result.scroll, 0, result.label)
        if (count === 7 && links && mode !== 'off')
          await capture(page, resolve(evidence, `${prefix}-7-${mode}-${width}x${height}.png`))
      }
  }
  for (const [width, capacity, counts] of [
    [1440, 4, [0, 1, 2, 3, 5, 6, 7, 9, 10, 11]],
    [1280, 3, [1, 2, 4, 5, 7, 8]],
    [1180, 3, [7, 8]],
    [813, 2, [1, 3, 5, 7]],
    [320, 1, [0, 1, 3, 7]],
  ]) {
    await page.setViewportSize({ width, height: 900 })
    for (const count of counts) {
      for (const links of [true, false]) {
        await render(count, 'page', links)
        const result = await inspect(`row-fill-${width}-${count}-${links}`)
        const plan = dashboardPlan(
          count,
          capacity,
          links,
          width === 1180 ? 'strip-single-tail' : 'fill',
        )
        const shared = links && plan.links !== 'strip'
        const entries = count + Number(shared)
        const expectedRows = Array.from({ length: Math.ceil(entries / plan.columns) }, (_, i) =>
          Math.min(plan.columns, entries - i * plan.columns),
        )
        if (links && !shared) expectedRows.push(1)
        assert.equal(result.columnCount, plan.columns)
        assert.deepEqual(
          result.rowBoundaries.map((row) => row.items.length),
          expectedRows,
        )
      }
    }
  }
  for (const [width, expectedColumns, expectedRows] of [
    [1440, 4, 2],
    [1280, 3, 3],
    [1180, 3, 4],
    [1024, 2, 4],
    [390, 1, 8],
  ]) {
    await page.setViewportSize({ width, height: 900 })
    for (const count of [1, 2, 3, 4]) {
      await render(7, 'banner', true, count)
      const result = await inspect(`navigation-${width}-${count}`)
      const last = result.cards.at(-1),
        nav = result.navigation
      assert.equal(result.columnCount, expectedColumns)
      assert.equal(result.rows, expectedRows)
      await expect(page.locator('[data-module="links"] a')).toHaveCount(count)
      if (expectedColumns === 3 && width !== 1180) {
        assert.equal(nav.start, 'span 6')
        assert.equal(nav.align, 'stretch')
        assert.ok(Math.abs(nav.width - last.width) < 1)
        assert.ok(Math.abs(nav.x - last.right - result.expectedGap) < 1)
        assert.ok(Math.abs(nav.y - last.y) < 1)
        assert.ok(Math.abs(nav.bottom - last.bottom) < 1)
        assert.equal(nav.leadingSpace, 0)
        assert.equal(nav.columns, Math.min(2, count))
      } else if (width === 1180) {
        assert.equal(nav.start, 'span 12')
        assert.ok(Math.abs(nav.y - last.bottom - result.expectedGap) < 1)
        assert.equal(nav.columns, count)
        assert.equal(nav.height, 64)
        for (const row of result.rowBoundaries) {
          assert.ok(Math.abs(row.left - result.grid.x) < 1)
          assert.ok(Math.abs(row.right - result.grid.right) < 1)
          const size = row.items.length
          for (const item of row.items)
            assert.ok(
              Math.abs(item.width - (result.grid.width - (size - 1) * result.expectedGap) / size) <
                1,
            )
        }
      } else if (expectedColumns > 1) {
        assert.ok(Math.abs(nav.y - last.y) < 1)
        assert.ok(Math.abs(nav.bottom - last.bottom) < 1)
        assert.equal(nav.columns, Math.min(count, 2))
      }
      if (count === 4) {
        const name =
          width === 1180
            ? 'space-331-strip'
            : expectedColumns === 3
              ? 'space-331'
              : expectedColumns === 4
                ? 'space-4x2'
                : `space-${expectedColumns}-columns`
        await capture(page, resolve(evidence, `${name}.png`))
        await page.screenshot({
          path: resolve(evidence, `${name}-full.png`),
          fullPage: true,
        })
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await render(7, 'banner', false)
  const withoutLinks = await inspect('seven-without-navigation')
  assert.equal(withoutLinks.rows, 3)
  assert.equal(withoutLinks.navigation, null)
  const rowSizes = Object.values(
    withoutLinks.cards.reduce((rows, c) => {
      const key = Math.round(c.y)
      rows[key] = (rows[key] ?? 0) + 1
      return rows
    }, {}),
  )
  assert.deepEqual(rowSizes, [3, 3, 1])
  for (const row of withoutLinks.rowBoundaries) {
    assert.ok(Math.abs(row.left - withoutLinks.grid.x) < 1)
    assert.ok(Math.abs(row.right - withoutLinks.grid.right) < 1)
  }
  await capture(page, resolve(evidence, 'fallback-without-links.png'))
  await page.screenshot({
    path: resolve(evidence, 'fallback-without-links-full.png'),
    fullPage: true,
  })
  for (const count of [7, 6, 7]) {
    await render(count, 'page')
    const result = await inspect('toggle-tailscale-' + count)
    assert.equal(result.rows, 3)
    assert.equal(result.navigation.start, count === 7 ? 'span 6' : 'span 12')
  }
  // A wide browser can host a narrow dashboard (sidebar or embedded preview).
  await page.setViewportSize({ width: 1440, height: 900 })
  await render(7, 'page')
  const embedded = await page.addStyleTag({
    content: '.dashboard-grid-container {width:min(100%,1217px); margin-inline:auto} ',
  })
  await stable(page)
  const inset = await inspect('wide-window-narrow-container')
  assert.equal(inset.columnCount, 3)
  assert.equal(inset.rows, 3)
  assert.ok(Math.abs(inset.navigation.bottom - inset.cards.at(-1).bottom) < 1)
  await embedded.evaluate((el) => el.remove())
  for (const width of [1440, 1280, 1180, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await render(7, 'page', true, 0)
    const result = await inspect('empty-navigation-' + width)
    await expect(page.locator('[data-module="links"] a')).toHaveCount(0)
    assert.equal(result.navigation.items.length, 0)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await render(7, 'page')
  const boundary = await page.addStyleTag({
    content: '.dashboard-grid-container {width:1328px; margin-inline:auto}',
  })
  for (const width of [699, 700, 1039, 1040, 1159, 1160, 1327, 1328, 1327, 1328]) {
    await boundary.evaluate(
      (el, width) =>
        (el.textContent = `.dashboard-grid-container {width:${width}px; margin-inline:auto}`),
      width,
    )
    await stable(page)
    const result = await inspect('boundary-' + width)
    assert.equal(result.columnCount, width >= 1328 ? 4 : width >= 1040 ? 3 : width >= 700 ? 2 : 1)
    assert.equal(result.rows, width >= 1328 ? 2 : width >= 1160 ? 3 : width >= 700 ? 4 : 8)
  }
  await boundary.evaluate((el) => el.remove())
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const options of [
    { empty: true, disabled: [] },
    { guest: true },
    { loginOnly: true },
    { disabled: ['devices', 'tailscale', 'services'] },
    { customTitles: true, disabled: [] },
  ]) {
    current = await fixture(options)
    const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await response
    await expect(page.locator('.dashboard-grid > [data-module]')).toHaveCount(
      current.modules.length,
    )
    await stable(page)
    await inspect('visibility-' + JSON.stringify(options))
    for (const m of current.modules.filter((m) => m.kind === 'login_required')) {
      await expect(page.locator(`[data-module="${m.id}"]`)).toContainText('登录后查看')
      assert.ok(!('snapshot' in m))
    }
  }
  await render(7, 'page')
  await page.locator('[data-module="services"] .module-body').evaluate((el) => {
    const warning = document.createElement('p')
    warning.setAttribute('role', 'alert')
    warning.textContent = '必须完整展示的重要错误信息。'.repeat(40)
    el.prepend(warning)
  })
  await stable(page)
  const warning = await inspect('mandatory-warning')
  assert.ok(warning.scroll > 0)
  await page
    .locator('[data-module="services"] .module-body > [role="alert"]')
    .evaluate((el) => el.remove())
  const zoom = await page.addStyleTag({ content: '.nozoki-app {zoom:1.5}' })
  await stable(page)
  const scaled = await inspect('browser-scale-150-percent')
  assert.ok(scaled.scroll > 0)
  await zoom.evaluate((el) => el.remove())
  await stable(page)
  await render(5, 'page')
  for (const title of ['设备', '服务状态', '自选行情', 'DeepSeek']) {
    const button = page.getByRole('button', { name: `查看${title}详情`, exact: true })
    await button.click()
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await expect(dialog).toBeVisible()
    if (title === '设备') await expect(dialog.locator('.device-row')).toHaveCount(7)
    if (title === '服务状态') await expect(dialog.locator('.monitor-row')).toHaveCount(12)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(button).toBeFocused()
  }
  assert.deepEqual(errors, [])
}
