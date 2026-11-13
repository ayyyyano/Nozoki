// Offline presentation fixtures only; never persisted to D1.
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, fixed } from '../fixtures/layout.ts'
import { presentationSnapshots } from '../fixtures/presentation.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { codexRingProjection } from '../../server/services/dashboard-presentation.ts'
import { balanceDays } from '../../shared/domain/daily-balances.ts'
import { decimalText } from '../../shared/domain/format.ts'
import { settle } from './support.ts'
import { stable } from './layout-support.ts'

export async function exerciseCardMetrics(page, { origin, evidence }) {
  await mkdir(evidence, { recursive: true })
  const errors = [],
    report = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.clock.setFixedTime(fixed)
  const current = await fixture({ stale: true, devices: 4, monitors: 8, disabled: [] })
  const devices = current.modules.find((m) => m.id === 'devices').snapshot.data.devices
  devices[0].statusUpdatedAt = new Date(fixed.getTime() - 2 * 86400000).toISOString()
  const presentation = presentationSnapshots(fixed)
  const { sourceId: _tailSource, ...tailnet } = presentation.tailscale
  const { sourceId: _codexSource, ...codex } = presentation.codex
  Object.assign(current.modules.find((m) => m.id === 'tailscale').snapshot, tailnet)
  Object.assign(current.modules.find((m) => m.id === 'codex').snapshot, {
    ...codex,
    data: {
      ...codex.data,
      ringView: codexRingProjection(
        codex.data,
        codex,
        createDefaultConfig().modules.find((m) => m.id === 'codex'),
        fixed.getTime(),
        true,
      ),
    },
  })
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
  balances.lastSuccessAt = balances.collectedAt
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
  const card = (id) => page.locator(`[data-module="${id}"]`)
  async function open(id) {
    const title = await card(id).getByRole('heading', { level: 2 }).innerText()
    const trigger = card(id).getByRole('button', { name: `查看${title}详情`, exact: true })
    await trigger.click()
    const panel = page.getByRole('dialog', { name: title, exact: true })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible()
    return panel
  }
  async function close(panel) {
    const title = await panel.getByRole('heading', { level: 2 }).innerText()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(page.getByRole('button', { name: `查看${title}详情`, exact: true })).toBeFocused()
  }
  for (const width of [1920, 1440, 1391, 1280, 320]) {
    await show(width)
    const balance = page.locator('[data-module="deepseek"]')
    const quotes = page.locator('[data-module="quotes"]')
    await expect(balance).not.toContainText('今日随采集更新')
    await expect(balance).not.toContainText('账户余额')
    await expect(balance.locator('.metric-value')).toHaveCount(0)
    await expect(balance.locator('.balance-bar-value')).toHaveText(
      amounts.filter((v) => v !== null).map(decimalText),
    )
    await expect(page.locator('.dashboard-grid .module-card time')).toHaveCount(0)
    await expect(page.locator('.dashboard-grid')).not.toContainText(/已过期|数据过期/)
    await expect(card('devices')).not.toContainText('较旧')
    await expect(card('activity')).not.toContainText('计划状态 · Asia/Shanghai')
    const cards = await page.locator('.dashboard-grid > .module-card').evaluateAll((items) =>
      items.map((item) => ({
        id: item.getAttribute('data-module'),
        height: item.getBoundingClientRect().height,
        fits:
          item.scrollHeight <= item.clientHeight + 1 && item.scrollWidth <= item.clientWidth + 1,
      })),
    )
    assert.equal(cards.length, 7)
    assert.ok(
      cards.every((item) => item.fits),
      JSON.stringify(cards),
    )
    if (width >= 1280)
      assert.ok(
        cards.every((item) => item.height === 240),
        JSON.stringify(cards),
      )
    for (const [id, selector] of [
      ['devices', '.device-list'],
      ['codex', '.codex-ring-grid'],
      ['quotes', '.quote-list'],
    ]) {
      const offset = await card(id)
        .locator(selector)
        .evaluate((content) => {
          const body = content.parentElement.getBoundingClientRect()
          const block = content.getBoundingClientRect()
          return Math.abs(block.top - body.top - (body.bottom - block.bottom))
        })
      assert.ok(offset < 1, `${id}: vertical offset ${offset}px at ${width}px`)
    }
    for (const [id, label] of [
      ['deepseek', '采集于'],
      ['devices', '观测于'],
      ['services', '采集于'],
      ['tailscale', '采集于'],
      ['codex', '同步于'],
    ]) {
      const panel = await open(id)
      await expect(panel.locator('.module-detail-subtitle')).toContainText(label)
      await expect(panel.locator('.module-detail-subtitle time')).toHaveCount(1)
      if (id === 'codex') {
        await expect(panel).not.toContainText(/来源就绪|执行成功|暂无队列用量/)
        await expect(panel.getByText('原始配额观测', { exact: true })).toBeVisible()
        await expect(panel.getByText('总 Token 120', { exact: true })).toBeVisible()
      }
      await close(panel)
    }
    await expect(quotes.locator('.quote-details')).toHaveCount(0)
    const quoteDetail = await open('quotes')
    const subtitle = quoteDetail.locator('.module-detail-subtitle')
    await expect(subtitle).toContainText('数据已过期')
    await expect(quoteDetail.locator('.module-detail-content')).not.toContainText('已过期')
    await expect(subtitle).toContainText('QQQM')
    await expect(subtitle).toContainText('VOO')
    await expect(subtitle.locator('time')).toHaveCount(2)
    await expect(subtitle.locator('time').first()).toHaveAttribute(
      'datetime',
      '2026-11-02T17:00:00.000Z',
    )
    const detail = quoteDetail.locator('.quote-details').first()
    await expect(detail).toContainText('昨收')
    await expect(detail).toContainText('振幅')
    await expect(detail).toContainText('成交')
    const panelBounds = await quoteDetail.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) => animation.finished))
      const { x, y, width, height } = el.getBoundingClientRect()
      const popup = el.parentElement.getBoundingClientRect()
      return { x, y, width, height, popupWidth: popup.width, popupHeight: popup.height }
    })
    const { x, y, width: panelWidth, height, popupWidth, popupHeight } = panelBounds
    if (width >= 768) {
      assert.equal(panelWidth, 680, JSON.stringify(panelBounds))
      assert.ok(height <= popupHeight - 48, JSON.stringify(panelBounds))
      assert.ok(Math.abs(popupWidth - panelWidth - 2 * x) < 1, JSON.stringify(panelBounds))
      assert.ok(Math.abs(popupHeight - height - 2 * y) < 1, JSON.stringify(panelBounds))
    } else {
      assert.deepEqual([x, y, panelWidth, height], [0, 0, popupWidth, popupHeight])
    }
    if ([1440, 320].includes(width))
      await page.screenshot({ path: resolve(evidence, `quote-dialog-${width}.png`) })
    await close(quoteDetail)
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
      }
    })
    assert.ok(geometry.pageWidth <= width, JSON.stringify(geometry))
    for (const { label, bar } of geometry.labels) {
      assert.ok(label.bottom <= bar.top + 1, JSON.stringify({ label, bar }))
      assert.ok(label.scroll <= label.client + 1, JSON.stringify(label))
      assert.ok(label.bottom - label.top <= label.lineHeight + 1, JSON.stringify(label))
    }
    report.push({ ...geometry, cards })
    if ([1440, 320].includes(width)) {
      await balance.screenshot({ path: resolve(evidence, `daily-balances-${width}.png`) })
      await quotes.screenshot({ path: resolve(evidence, `quote-details-${width}.png`) })
    }
  }
  // Matching quote times share one line in the detail subtitle.
  const quoteData = current.modules.find((m) => m.id === 'quotes').snapshot.data.items
  quoteData[1].asOf = quoteData[0].asOf
  quoteData[1].delayedMinutes = quoteData[0].delayedMinutes
  await show(1440)
  let quoteDetail = await open('quotes')
  await expect(quoteDetail.locator('.module-detail-subtitle time')).toHaveCount(1)
  await close(quoteDetail)
  // Missing quote fields remain absent; fallback observation is explicitly identified.
  for (const quote of quoteData) {
    quote.previousClose = null
    quote.amplitudePercent = null
    quote.volume = null
    quote.asOf = null
    quote.delayedMinutes = null
  }
  await show(320)
  quoteDetail = await open('quotes')
  await expect(quoteDetail.locator('.quote-details')).toHaveCount(0)
  await expect(quoteDetail.locator('.module-detail-subtitle')).toContainText('观测于')
  await close(quoteDetail)
  balances.data = { masked: true }
  await show(320)
  await expect(page.locator('.balance-private')).toBeVisible()
  await expect(page.locator('.balance-bar-value')).toHaveCount(0)
  await expect(page.locator('[data-module="deepseek"] footer')).toHaveCount(0)
  assert.deepEqual(errors, [])
  await writeFile(resolve(evidence, 'card-metrics.json'), JSON.stringify(report, null, 2))
}
