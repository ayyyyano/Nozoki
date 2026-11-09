// Synthetic presentation data and disposable Worker/D1 only; never writes daily data.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { bindSources } from '../../shared/integration-presets/bindings.ts'
import { balanceDays } from '../../shared/domain/daily-balances.ts'
import { fixture, fixed } from '../fixtures/layout.ts'
import { settle } from './support.ts'
import { stable, measure, capture } from './layout-support.ts'

export async function exerciseHomeSummary(
  page,
  { origin, evidence, input, request, save, collector },
) {
  await mkdir(evidence, { recursive: true })
  await page.clock.setFixedTime(fixed)
  let current = await fixture({ monitors: 12, devices: 7, stale: true })
  const balance = current.modules.find((m) => m.id === 'deepseek').snapshot
  balance.data.balances = balance.data.balances.filter((b) => b.currency === 'CNY')
  for (const id of ['codex', 'tailscale']) {
    const m = current.modules.find((m) => m.id === id)
    if (m) {
      m.snapshot.data = null
      m.snapshot.status = 'unconfigured'
      m.snapshot.sourceConfigured = false
    }
  }
  balance.data.dailyBalances = balanceDays(fixed, 'Asia/Shanghai').map(({ day }, i) => ({
    day,
    currency: 'CNY',
    total: String(100 - i),
    collectedAt: fixed.toISOString(),
  }))
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  async function settledLayout() {
    await page.waitForFunction(() => {
      const rects = [...document.querySelectorAll('.dashboard-grid > [data-module]')].map((el) =>
        el.getBoundingClientRect(),
      )
      return rects.every((a, i) =>
        rects
          .slice(i + 1)
          .every(
            (b) =>
              Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 ||
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1,
          ),
      )
    })
    await stable(page)
    const result = await measure(page)
    assert.ok(
      result.columnGaps.every((g) => g.gap >= result.expectedGap - 1),
      JSON.stringify(result),
    )
    return result
  }
  if (!process.env.NOZOKI_HOME_ADMIN_ONLY) {
    await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
    const report = []
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [768, 1024],
      [390, 844],
      [320, 844],
    ]) {
      await page.setViewportSize({ width, height })
      await page.goto(origin)
      await settle(page)
      const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await response
      await stable(page)
      let metrics = await measure(page)
      if (!process.env.NOZOKI_HOME_BEFORE) {
        assert.ok(metrics.pageWidth <= width)
        await expect(page.locator('[data-module="services"] .monitor-row')).toHaveCount(8)
        await expect(page.locator('[data-module="devices"] .device-row')).toHaveCount(4)
        await expect(page.locator('[data-module="links"] .link-grid a')).toHaveCount(4)
        await expect(page.locator('[data-module="quotes"] .quote-details')).toHaveCount(0)
        await expect(page.locator('[data-module="quotes"]')).not.toContainText('最近成功')
        await expect(page.locator('.balance-bars .balance-bar-value')).toHaveCount(7)
        metrics = await settledLayout()
        if (width >= 1280) {
          assert.equal(metrics.columnCount, 3)
          assert.ok(metrics.quoteColumns.split(' ').length === 2)
        }
        for (const title of process.env.NOZOKI_HOME_CAPTURE_ONLY
          ? []
          : ['服务状态', '设备', '自选行情', 'DeepSeek']) {
          const trigger = page.getByRole('button', { name: `查看${title}详情`, exact: true })
          await trigger.click()
          const dialog = page.getByRole('dialog', { name: title + '详情', exact: true })
          await expect(dialog).toBeVisible()
          await page.waitForFunction(() =>
            document.getAnimations().every((a) => a.playState !== 'running'),
          )
          if (title === '服务状态') await expect(dialog.locator('.monitor-row')).toHaveCount(12)
          if (title === '设备') await expect(dialog.locator('.device-row')).toHaveCount(7)
          if (title === '自选行情') await expect(dialog).toContainText('昨收')
          assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
          assert.ok(
            await dialog.evaluate((el) => {
              const r = el.getBoundingClientRect()
              return r.left >= -1 && r.right <= innerWidth + 1
            }),
          )
          if ([1440, 390].includes(width))
            await page.screenshot({ path: resolve(evidence, `detail-${title}-${width}.png`) })
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden()
          await expect(trigger).toBeFocused()
        }
      }
      report.push(metrics)
      await page.evaluate(() => document.activeElement?.blur())
      await page.mouse.move(0, 0)
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== 'running'),
      )
      await capture(
        page,
        resolve(
          evidence,
          `${process.env.NOZOKI_HOME_BEFORE ? 'baseline' : 'summary'}-${width}.png`,
        ),
      )
    }
    await writeFile(
      resolve(evidence, process.env.NOZOKI_HOME_BEFORE ? 'baseline.json' : 'summary.json'),
      JSON.stringify(report, null, 2),
    )
    if (process.env.NOZOKI_HOME_BEFORE || process.env.NOZOKI_HOME_CAPTURE_ONLY) return
    // Quantity changes, empty states, mixed health and explicit selections use isolated DTO fixtures.
    for (const count of [0, 1, 2, 3, 4, 9]) {
      current = await fixture({
        devices: count || undefined,
        monitors: count || undefined,
        links: Math.min(count, 5),
        only: ['devices', 'services', 'links', 'quotes', 'deepseek'],
      })
      if (!count) {
        current.modules.find((m) => m.id === 'devices').snapshot.data.devices = []
        current.modules.find((m) => m.id === 'services').snapshot.data.monitors = []
        current.modules.find((m) => m.id === 'links').snapshot.data.items = []
      }
      const w = [1, 3, 4].includes(count) ? 1440 : 390
      await page.setViewportSize({ width: w, height: 900 })
      const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await response
      await stable(page)
      await expect(page.locator('[data-module="devices"] .device-row')).toHaveCount(
        Math.min(4, count),
      )
      await expect(page.locator('[data-module="services"] .monitor-row')).toHaveCount(
        Math.min(8, count),
      )
      await expect(page.locator('[data-module="links"] .link-grid a')).toHaveCount(
        Math.min(4, count),
      )
      if ([1, 3, 4].includes(count)) await capture(page, resolve(evidence, `devices-${count}.png`))
    }
  }
  if (!process.env.NOZOKI_HOME_ADMIN_ONLY) {
    for (const options of [
      { quotes: 1, only: ['quotes', 'services'] },
      {
        quotes: 4,
        disabled: [],
        order: [
          'services',
          'links',
          'quotes',
          'devices',
          'activity',
          'codex',
          'tailscale',
          'deepseek',
        ],
      },
      { quotes: 2, customTitles: true, disabled: ['devices', 'tailscale'] },
    ]) {
      current = await fixture(options)
      for (const id of ['codex', 'tailscale']) {
        const m = current.modules.find((m) => m.id === id)
        if (m?.kind === 'data') {
          m.snapshot.data = null
          m.snapshot.status = 'unconfigured'
          m.snapshot.sourceConfigured = false
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await response
      await stable(page)
      assert.deepEqual(
        await page
          .locator('.dashboard-grid > [data-module]')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-module'))),
        current.modules.map((m) => m.id),
      )
      assert.ok((await measure(page)).pageWidth <= 1440)
      await expect(page.locator('[data-module="quotes"] .quote-item')).toHaveCount(
        Math.min(2, options.quotes),
      )
    }
  }
  // Real authenticated Worker + D1 save and re-read, not fixture-only checkbox checks.
  await page.unroute('**/api/dashboard')
  const initial = await input()
  const source = createIntegrationDraft('uptimeflare', initial.config.integrations, 'home')
  source.baseUrl = 'https://home-fixture.example.com/'
  source.enabled = true
  const result = await (
    await request('/api/admin/integrations/' + source.id + '/test', 'POST', {
      expectedVersion: initial.expectedVersion,
      draft: source,
      quoteSymbols: [],
    })
  ).json()
  assert.ok(result.connectionProof, JSON.stringify(result))
  source.access.approved = true
  source.access.approvedTarget = sourceTargetKey(source, source.access)
  source.connectionProof = result.connectionProof
  initial.config.integrations.push(source)
  initial.config = bindSources(initial.config)
  initial.config.modules.find((m) => m.id === 'services').visibility = 'public'
  assert.equal((await save(initial)).status, 200)
  await collector.collect()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin + '/admin')
  await settle(page)
  await page.getByRole('button', { name: 'Dashboard 模块', exact: true }).click()
  const service = page.locator('[data-edit-module="services"]')
  await service.locator('.admin-item-toggle').click()
  await page.screenshot({ path: resolve(evidence, 'admin-debug.png'), fullPage: true })
  await writeFile(
    resolve(evidence, 'admin-debug.json'),
    JSON.stringify(
      {
        dashboard: await (await request('/api/dashboard')).json(),
        config: await input(),
        text: await service.innerText(),
        errors,
      },
      null,
      2,
    ),
  )
  await expect(service.getByRole('checkbox')).toHaveCount(10)
  await service.getByRole('checkbox', { name: 'service-0', exact: true }).uncheck()
  await expect(service.getByRole('checkbox', { name: 'service-0', exact: true })).not.toBeChecked()
  await service.getByRole('checkbox', { name: 'service-9', exact: true }).click()
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await saved).status(), 200)
  const actual = await input()
  const selection = actual.config.modules.find((m) => m.id === 'services').homeServices
  assert.equal(selection.length, 8)
  assert.equal(selection.at(-1).monitorId, source.id + '/service-9')
  assert.ok(!selection.some((s) => s.monitorId.endsWith('/service-0')))
  await page.reload()
  await settle(page)
  await page.getByRole('button', { name: 'Dashboard 模块', exact: true }).click()
  await page.locator('[data-edit-module="services"] .admin-item-toggle').click()
  await expect(page.getByRole('checkbox', { name: 'service-0', exact: true })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'service-9', exact: true })).toBeChecked()
  await page.screenshot({ path: resolve(evidence, 'services-home-admin.png'), fullPage: true })
  const tooMany = structuredClone(actual)
  tooMany.config.links.push({ ...tooMany.config.links[0], id: 'link-fifth', sortOrder: 4 })
  assert.equal((await save(tooMany)).status, 400)
  assert.equal((await input()).expectedVersion, actual.expectedVersion)
  await page.getByRole('button', { name: '常用链接', exact: true }).click()
  await expect(page.getByRole('button', { name: '添加链接', exact: true })).toBeDisabled()
  // Deselect every service: an explicit empty list persists; new monitors do not fill it.
  actual.config.modules.find((m) => m.id === 'services').homeServices = []
  assert.equal((await save(actual)).status, 200)
  assert.deepEqual((await input()).config.modules.find((m) => m.id === 'services').homeServices, [])
  const dashboard = await (await request('/api/dashboard')).json()
  const services = dashboard.modules.find((m) => m.id === 'services').snapshot
  assert.deepEqual(services.homeItems, [])
  assert.equal(services.data.monitors.length, 10)
  assert.equal(dashboard.summary.services.down, 1)
  const guarded = await input()
  guarded.config.modules.find((m) => m.id === 'services').fields[
    '/monitors/@' + (source.id + '/service-9').replaceAll('/', '~1')
  ] = { enabled: false, visibility: 'admin' }
  assert.equal((await save(guarded)).status, 200)
  const guest = await (await request('/api/dashboard', 'GET', undefined, { Cookie: '' })).json()
  assert.ok(!JSON.stringify(guest).includes('service-9'))
  assert.equal(guest.summary.services.down, 0)
  assert.deepEqual(errors, [])
}
