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
  // The widest percentage must fit alongside charging and an independent age warning.
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
  async function render(count, mode, links = true) {
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
    const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await response
    await expect(page.locator('.dashboard-grid > [data-module]')).toHaveCount(
      selected.length + Number(links),
    )
    await expect(page.locator('.nozoki-app')).toHaveAttribute('data-background-layout', mode)
    await stable(page)
    if (count > 7) {
      const plans = [2, 3, 4].map((capacity) => dashboardPlan(count, capacity, links))
      await page.evaluate(
        ({ count, plans }) => {
          const grid = document.querySelector('.dashboard-grid')
          const extra = grid.querySelector('[data-module="codex"]').cloneNode(true)
          extra.setAttribute('data-module', 'future-fixture')
          extra.querySelector('h2').textContent = '未来业务模块'
          extra.querySelector('h2').id = 'future-fixture-title'
          extra.setAttribute('aria-labelledby', 'future-fixture-title')
          grid.insertBefore(extra, grid.querySelector('[data-module="links"]'))
          grid.dataset.businessCount = String(count)
          grid.dataset.mediumLinks = plans[0].links
          grid.dataset.wideLinks = plans[1].links
          grid.dataset.expandedLinks = plans[2].links
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
      const columns = getComputedStyle(
        document.querySelector('.dashboard-grid'),
      ).gridTemplateColumns.split(' ').length
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
        rows: [
          ...new Set(
            [...document.querySelectorAll('.dashboard-grid > [data-module]')].map((el) =>
              Math.round(el.getBoundingClientRect().y),
            ),
          ),
        ].length,
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
        assert.ok(result.cards.every((c) => c.height <= 244))
        assert.equal(result.devicesColumns.split(' ').length, 2)
        assert.equal(result.serviceColumns.split(' ').length, 2)
        assert.equal(result.quoteColumns.split(' ').length, 2)
        if (count === 7) assert.ok(result.minCardWidth >= 320)
        for (const id of ['deepseek', 'devices', 'quotes', 'services']) {
          await expect(page.locator(`[data-module="${id}"] .summary-status`)).toContainText(
            '已过期',
          )
          await expect(
            page.locator(`[data-module="${id}"] .module-body > .data-state`),
          ).toHaveCount(0)
        }
        await expect(page.locator('[data-module="services"] .monitor-row')).toHaveCount(8)
        await expect(page.locator('[data-module="services"] footer')).toContainText(
          '全部监控：4 项异常',
        )
        await expect(page.locator('[data-module="services"] .module-body')).not.toContainText(
          '全部监控',
        )
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
        if (count > 7)
          await page.locator('[data-module="future-fixture"]').evaluate((el) => el.remove())
      }
  }
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 900 })
    for (const count of [0, 1, 2, 3]) {
      await render(count, 'page')
      const result = await inspect(`small-dashboard-${width}-${count}`)
      const capacity = result.grid.width >= 1328 ? 4 : result.grid.width >= 700 ? 2 : 1
      assert.equal(result.columnCount, dashboardPlan(count, capacity, true).columns)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const options of [
    { empty: true, disabled: [] },
    { guest: true },
    { loginOnly: true },
    { disabled: ['devices', 'tailscale', 'services'] },
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
    const dialog = page.getByRole('dialog', { name: title + '详情', exact: true })
    await expect(dialog).toBeVisible()
    if (title === '设备') await expect(dialog.locator('.device-row')).toHaveCount(7)
    if (title === '服务状态') await expect(dialog.locator('.monitor-row')).toHaveCount(12)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(button).toBeFocused()
  }
  assert.deepEqual(errors, [])
}
