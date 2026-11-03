import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { runAdapter } from '../../server/adapters/registry.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { readConfig } from '../../server/services/config.ts'
import { tailscaleFixture } from '../fixtures/tailscale.ts'
import { sleepyDevicesFixture } from '../fixtures/devices0511.ts'
import { tencentFixtures } from '../fixtures/tencent-quotes.ts'

export async function exerciseTailscale(page, context, origin, databasePath) {
  const select = async (scope, label, value) => {
    await page.bringToFront()
    await scope.getByLabel(label, { exact: true }).click()
    await page
      .locator('.var-menu__menu:visible .var-option')
      .filter({ hasText: new RegExp('^' + value + '$') })
      .click()
  }
  const save = async () => {
    await page.bringToFront()
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    assert.equal((await response).status(), 200)
    await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
    await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled()
  }
  await page.getByRole('button', { name: '数据源', exact: true }).click()
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  const source = page.locator('fieldset:visible .admin-editor-item').last()
  await select(source, '凭据操作', 'replace · 替换')
  await source.locator('input[aria-label="新凭据"]').fill('null')
  await select(source, 'Provider', 'tailscale')
  await source.getByRole('textbox', { name: '来源 ID', exact: true }).fill('tailscale-ui')
  await expect(source.getByRole('textbox', { name: '服务根 HTTPS 地址', exact: true })).toHaveValue(
    'https://api.tailscale.com/',
  )
  await source
    .getByRole('textbox', { name: 'OAuth Client ID', exact: true })
    .fill('synthetic-client')
  await source.locator('input[aria-label="OAuth Client Secret"]').fill('synthetic-secret')
  await source.getByLabel('启用来源', { exact: true }).click()
  await save()
  const savedSourceConfig = await (await context.request.get(origin + '/api/admin/config')).json()
  assert.ok(!JSON.stringify(savedSourceConfig).includes('synthetic-secret'))
  assert.ok(!JSON.stringify(savedSourceConfig).includes('synthetic-client'))
  assert.equal(
    savedSourceConfig.integrations.find((integration) => integration.id === 'tailscale-ui')
      .credentialState.configured,
    true,
  )
  await expect(source.getByLabel('OAuth Client Secret', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Dashboard 模块', exact: true }).click()
  const item = (id) => page.locator(`[data-edit-module="${id}"]`)
  await item('tailscale').locator('.admin-item-toggle').click()
  await item('tailscale').getByLabel('启用 tailscale', { exact: true }).click()
  await select(item('tailscale'), 'tailscale 模块权限', '公开')
  const refs = item('tailscale').locator('details').first()
  await refs.locator('summary').focus()
  await page.keyboard.press('Space')
  await refs.getByRole('button', { name: '添加 main 引用', exact: true }).click()
  await select(refs, 'tailscale main 来源', 'tailscale-ui')
  await expect(item('tailscale').getByLabel('Tailscale IP 显示')).toContainText('登录后显示')
  await save()

  // Populate this isolated test DB with adapter-validated offline fixtures, not daily data.
  const db = new SqliteDatabase(databasePath)
  try {
    const config = await readConfig(db),
      tailnet = config.integrations.find((i) => i.id === 'tailscale-ui')
    const now = new Date()
    const read = await runAdapter({
      source: tailnet,
      now,
      transport: { get: async () => ({ value: tailscaleFixture(), ageSeconds: null }) },
    })
    assert.equal(read.status, 'ok')
    await upsertSnapshot(db, {
      sourceId: tailnet.id,
      subject: 'default',
      moduleId: 'tailscale',
      snapshot: read.views.tailscale,
      updatedAt: now.toISOString(),
    })
    const sleepy = {
      ...tailnet,
      id: 'saved-legacy',
      provider: 'sleepy',
      protocolVersion: 'sleepy-v5-status',
    }
    const fixture = sleepyDevicesFixture()
    fixture.time = now.getTime() / 1000
    fixture.last_updated = fixture.time
    const sleepyRead = await runAdapter({
      source: sleepy,
      now,
      transport: { get: async () => ({ value: fixture, ageSeconds: null }) },
    })
    assert.equal(sleepyRead.status, 'ok')
    await upsertSnapshot(db, {
      sourceId: sleepy.id,
      subject: 'default',
      moduleId: 'devices',
      snapshot: sleepyRead.views.devices,
      updatedAt: now.toISOString(),
    })
    // Enable the fixture Sleepy source without a request; the Node server has no automatic Cron.
    await db
      .prepare(
        "UPDATE integrations SET enabled=1,base_url='https://sleepy.example/' WHERE id='saved-legacy'",
      )
      .run()
    await db
      .prepare(
        'UPDATE dashboard_modules SET sources_json=\'{"main":{"sourceId":"saved-legacy","subject":"default"}}\' WHERE id=\'devices\'',
      )
      .run()
    const quoteSource = {
      ...tailnet,
      id: 'quotes-fixture',
      baseUrl: 'https://web.ifzq.gtimg.cn/',
      protocolVersion: 'tencent-us-v1',
      provider: 'quotes-custom',
    }
    await db
      .prepare(
        "INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json) VALUES('quotes-fixture','quotes-custom','tencent-us-v1','https://web.ifzq.gtimg.cn/',1,300,'{}','{}')",
      )
      .run()
    const quoteRead = await runAdapter({
      source: quoteSource,
      now,
      quoteSymbols: [
        { market: 'US', symbol: 'QQQM' },
        { market: 'US', symbol: 'VOO' },
      ],
      transport: {
        get: async (endpoint) => ({
          value: tencentFixtures[endpoint.includes('QQQM') ? 'QQQM.OQ' : 'VOO.AM'],
          ageSeconds: null,
        }),
      },
    })
    assert.ok(quoteRead.views.quotes)
    await upsertSnapshot(db, {
      sourceId: quoteSource.id,
      subject: 'default',
      moduleId: 'quotes',
      snapshot: quoteRead.views.quotes,
      updatedAt: now.toISOString(),
    })
    await db
      .prepare(
        'UPDATE dashboard_modules SET sources_json=\'{"main":{"sourceId":"quotes-fixture","subject":"default"}}\' WHERE id=\'quotes\'',
      )
      .run()
    await db.prepare("UPDATE quote_symbols SET provider='quotes-fixture'").run()
  } finally {
    db.close()
  }
  const guest = await context.browser().newContext()
  const guestPage = await guest.newPage()
  const settle = async (p) => {
    // Headless Edge throttles animation frames in the other test tab.
    await p.bringToFront()
    await p.locator('[data-module="tailscale"]').waitFor()
    await p.waitForFunction(() => !document.querySelector('.dx-transition'), undefined, {
      timeout: 15000,
    })
  }
  try {
    await page.goto(origin)
    await settle(page)
    await expect(page.locator('[data-module="tailscale"]')).toContainText('100.64.1.2')
    await expect(page.locator('[data-module="activity"]')).not.toContainText('能力限制')
    const details = page.locator('.quote-extra').first()
    await expect(details).not.toHaveAttribute('open', '')
    await details.locator('summary').click()
    await expect(details.locator('.quote-details')).toBeVisible()
    await page.goto(origin + '/admin')
    await page.getByRole('button', { name: 'Dashboard 模块', exact: true }).click()
    await item('tailscale').locator('.admin-item-toggle').click()
    for (const [option, visible] of [
      ['不显示', false],
      ['显示', true],
      ['登录后显示', false],
    ]) {
      await select(item('tailscale'), 'Tailscale IP 显示', option)
      await save()
      await guestPage.goto(origin)
      await settle(guestPage)
      await expect(guestPage.locator('[data-module="tailscale"]')).toContainText('Fixture laptop')
      assert.equal(
        (await guestPage.locator('[data-module="tailscale"]').textContent()).includes('100.64.1.2'),
        visible,
      )
      const html = await (await guest.request.get(origin)).text()
      assert.equal(html.includes('100.64.1.2'), visible)
      if (!visible)
        await expect(guestPage.locator('[data-module="tailscale"]')).toContainText('****')
      const dto = await (await guest.request.get(origin + '/api/dashboard')).json()
      assert.equal(JSON.stringify(dto).includes('100.64.1.2'), visible)
    }
    // Move Services and Links into the middle using actual ordering controls.
    for (let n = 0; n < 4; n++)
      await item('services').getByRole('button', { name: '上移 services', exact: true }).click()
    for (let n = 0; n < 3; n++)
      await item('links').getByRole('button', { name: '上移 links', exact: true }).click()
    await save()
    await page.goto(origin)
    await settle(page)
    await mkdir('.wrangler/test-results/tailscale', { recursive: true })
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      )
      const bounds = await page.locator('.dashboard-grid > [data-module]').evaluateAll((elements) =>
        elements.map((e) => ({
          id: e.dataset.module,
          ...e.getBoundingClientRect().toJSON(),
          overflow: e.scrollWidth > e.clientWidth + 1,
        })),
      )
      assert.equal(bounds.length, 8)
      const grid = await page.locator('.dashboard-grid').boundingBox()
      for (const box of bounds) {
        assert.ok(!box.overflow, JSON.stringify(box))
        assert.ok(box.x >= grid.x - 1 && box.right <= grid.x + grid.width + 1)
      }
      const visual = [...bounds].sort((a, b) => (Math.abs(a.y - b.y) < 1 ? a.x - b.x : a.y - b.y))
      assert.deepEqual(
        visual.map((b) => b.id),
        bounds.map((b) => b.id),
      )
      for (let i = 0; i < bounds.length; i++)
        for (const b of bounds.slice(i + 1)) {
          const a = bounds[i]
          assert.ok(
            a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1,
          )
        }
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: `.wrangler/test-results/tailscale/fixture-${width}.png`,
          fullPage: true,
        })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(origin + '/admin')
  } finally {
    await guest.close()
  }
}
