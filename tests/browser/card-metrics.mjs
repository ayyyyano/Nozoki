// Offline presentation fixtures only; never persisted to D1.
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, fixed } from '../fixtures/layout.mjs'
import { balanceDays } from '../../shared/domain/daily-balances.ts'
import { decimalText } from '../../shared/domain/format.ts'
import { settle } from './support.mjs'
import { stable } from './layout-support.mjs'

export async function exerciseCardMetrics(page, { origin, evidence }) {
  await mkdir(evidence, { recursive: true })
  const errors = [],
    report = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.clock.setFixedTime(fixed)
  let current = await fixture({ stale: true })
  const balances = current.modules.find((m) => m.id === 'deepseek').snapshot
  const days = balanceDays(fixed, 'Asia/Shanghai')
  const amounts = ['128.50', '126.00', null, '0.00', '-2.00', '110.00', '108.25']
  balances.data.balances = [
    { currency: 'CNY', total: '108.25', toppedUp: '108.25', granted: '0.00' },
  ]
  balances.data.dailyBalances = days.flatMap(({ day }, i) =>
    amounts[i] === null
      ? []
      : [{ day, currency: 'CNY', total: amounts[i], collectedAt: fixed.toISOString() }],
  )
  balances.collectedAt = fixed.toISOString()
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
  async function show(width) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin)
    await settle(page)
    const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    await stable(page)
  }
  for (const width of [1440, 1024, 768, 390, 320]) {
    await show(width)
    const balance = page.locator('[data-module="deepseek"]')
    const quotes = page.locator('[data-module="quotes"]')
    await expect(balance).not.toContainText('今日随采集更新')
    await expect(balance).not.toContainText('账户余额')
    await expect(balance.locator('.metric-value')).toHaveCount(0)
    await expect(balance.locator('.balance-bar-value')).toHaveText(
      amounts.filter((v) => v !== null).map(decimalText),
    )
    await expect(balance.locator('footer.sync-time')).toContainText('采集于')
    await expect(quotes.locator('details, summary')).toHaveCount(0)
    for (const detail of await quotes.locator('.quote-details').all())
      await expect(detail).toBeVisible()
    await expect(quotes.locator('.quote-details').first()).toContainText('昨收')
    await expect(quotes.locator('.quote-details').first()).toContainText('振幅')
    await expect(quotes.locator('.quote-details').first()).toContainText('成交')
    const footer = quotes.locator('footer.sync-time')
    await expect(footer).toContainText('QQQM')
    await expect(footer).toContainText('VOO')
    await expect(footer.locator('time')).toHaveCount(2)
    await expect(footer.locator('time').first()).toHaveAttribute(
      'datetime',
      '2026-11-02T17:00:00.000Z',
    )
    const geometry = await page.evaluate(() => {
      const box = (e) => {
        const r = e.getBoundingClientRect()
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          scroll: e.scrollWidth,
          client: e.clientWidth,
        }
      }
      return {
        width: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        labels: [...document.querySelectorAll('.balance-bar-value')].map((e) => ({
          label: { ...box(e), lineHeight: parseFloat(getComputedStyle(e).lineHeight) },
          bar: box(e.nextElementSibling.querySelector('i')),
        })),
        quotes: [...document.querySelectorAll('.quote-item')].map(box),
        details: [...document.querySelectorAll('.quote-details')].map(box),
        footer: box(document.querySelector('[data-module="quotes"] footer')),
      }
    })
    assert.ok(geometry.pageWidth <= width, JSON.stringify(geometry))
    for (const { label, bar } of geometry.labels) {
      assert.ok(label.bottom <= bar.top + 1, JSON.stringify({ label, bar }))
      assert.ok(label.scroll <= label.client + 1, JSON.stringify(label))
      assert.ok(label.bottom - label.top <= label.lineHeight + 1, JSON.stringify(label))
    }
    assert.ok(geometry.footer.top >= Math.max(...geometry.quotes.map((q) => q.bottom)))
    for (const d of geometry.details) assert.ok(d.scroll <= d.client + 1)
    report.push(geometry)
    if ([1440, 320].includes(width)) {
      await balance.screenshot({ path: resolve(evidence, `daily-balances-${width}.png`) })
      await quotes.screenshot({ path: resolve(evidence, `quote-details-${width}.png`) })
    }
  }
  // Matching times share one footer line, without replacing quote time with collection time.
  const quoteData = current.modules.find((m) => m.id === 'quotes').snapshot.data.items
  quoteData[1].asOf = quoteData[0].asOf
  quoteData[1].delayedMinutes = quoteData[0].delayedMinutes
  await show(1440)
  await expect(page.locator('[data-module="quotes"] footer time')).toHaveCount(1)
  // Missing quote fields remain absent; fallback observation is explicitly identified.
  for (const quote of quoteData) {
    quote.previousClose = null
    quote.amplitudePercent = null
    quote.volume = null
    quote.asOf = null
    quote.delayedMinutes = null
  }
  await show(320)
  await expect(page.locator('.quote-details')).toHaveCount(0)
  await expect(page.locator('[data-module="quotes"] footer')).toContainText('观测于')
  balances.data = { masked: true }
  await show(320)
  await expect(page.locator('.balance-private')).toBeVisible()
  await expect(page.locator('.balance-bar-value')).toHaveCount(0)
  await expect(page.locator('[data-module="deepseek"] footer')).toHaveCount(0)
  assert.deepEqual(errors, [])
  await writeFile(resolve(evidence, 'card-metrics.json'), JSON.stringify(report, null, 2))
}
