// Runs against the caller's isolated Worker, authenticated fixture and disposable D1 only.
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function exerciseAdminListHeaders(page, { input, evidence }) {
  await mkdir(evidence, { recursive: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const initial = await input()
  const section = async (name) => {
    const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
    if (await trigger.isVisible()) {
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: '选择管理分区' })
      await dialog.getByRole('button', { name, exact: true }).click()
      await expect(dialog).toBeHidden()
    } else await page.getByRole('button', { name, exact: true }).click()
  }
  const modules = page.locator('[data-edit-module]')
  const module = (id) => page.locator(`[data-edit-module="${id}"]`)
  const link = (id) => page.locator(`[data-edit-link="${id}"]`)
  const toggle = async (card, label) => {
    await expect(card.locator('.admin-item-toggle')).toHaveAttribute('aria-expanded', 'false')
    const control = card.locator('header').getByRole('switch', { name: label, exact: true })
    await expect(control).toBeVisible()
    const enabled = await control.isChecked()
    await control.click()
    if (enabled) await expect(control).not.toBeChecked()
    else await expect(control).toBeChecked()
    await expect(card.locator('.admin-item-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(
      card.locator('.admin-item-body').getByRole('switch', { name: label, exact: true }),
    ).toHaveCount(0)
  }
  const symbols = {
    deepseek: 'auto_awesome',
    devices: 'devices',
    tailscale: 'hub',
    codex: 'code',
    activity: 'schedule',
    quotes: 'monitoring',
    links: 'link',
    services: 'dns',
  }
  await section('Dashboard 模块')
  for (const m of initial.config.modules) {
    const card = module(m.id)
    await expect(card.locator('.admin-item-toggle > .app-icon').first()).toHaveAttribute(
      'data-symbol',
      symbols[m.id],
    )
    await expect(
      card
        .getByRole('button', { name: `上移 ${m.id}`, exact: true })
        .locator('[data-symbol="arrow_upward"]'),
    ).toHaveCount(1)
    await expect(
      card
        .getByRole('button', { name: `下移 ${m.id}`, exact: true })
        .locator('[data-symbol="arrow_downward"]'),
    ).toHaveCount(1)
  }
  const order = initial.config.modules.map((m) => m.id)
  const down = module(order[0]).getByRole('button', { name: `下移 ${order[0]}`, exact: true })
  assert.equal((await down.innerText()).trim(), '')
  await down.focus()
  await page.keyboard.press('Enter')
  assert.deepEqual(await modules.evaluateAll((es) => es.map((e) => e.dataset.editModule)), [
    order[1],
    order[0],
    ...order.slice(2),
  ])
  await toggle(module('activity'), '启用 activity')
  const tailscale = module('tailscale')
  await tailscale.locator('.admin-item-toggle').click()
  const fields = await tailscale.locator('.admin-module-fields > *').all()
  const boxes = await Promise.all(fields.map((f) => f.boundingBox()))
  assert.equal(boxes.length, 3)
  for (const box of boxes) {
    assert.ok(Math.abs(box.y - boxes[0].y) <= 2)
    assert.ok(Math.abs(box.width - boxes[0].width) <= 2)
  }
  await page.screenshot({ path: resolve(evidence, 'module-headers-desktop.png'), fullPage: true })
  await tailscale.locator('.admin-item-toggle').click()

  await section('行情标的')
  const quoteCards = page.locator('[data-edit-quote]')
  const firstQuoteId = await quoteCards.nth(0).getAttribute('data-edit-quote')
  const secondQuoteId = await quoteCards.nth(1).getAttribute('data-edit-quote')
  const quote = (id) => page.locator(`[data-edit-quote="${id}"]`)
  const firstSymbol = initial.config.quotes[0].symbol
  const secondSymbol = initial.config.quotes[1].symbol
  await toggle(quote(firstQuoteId), '启用标的 1')
  await quote(secondQuoteId).locator('.admin-item-toggle').click()
  await quote(secondQuoteId)
    .getByRole('button', { name: `上移标的 ${secondSymbol}`, exact: true })
    .click()
  await expect(quoteCards.first()).toHaveAttribute('data-edit-quote', secondQuoteId)
  await expect(quote(secondQuoteId).locator('.admin-item-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(quote(firstQuoteId).locator('.admin-item-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  const symbolInput = quote(secondQuoteId).locator('input[aria-label="标的 1 代码"]')
  await expect(symbolInput).toHaveValue(secondSymbol)
  await symbolInput.fill('TEST')
  await expect(symbolInput).toBeFocused()
  await quote(firstQuoteId)
    .getByRole('button', { name: `移除标的 ${firstSymbol}`, exact: true })
    .click()
  await expect(quoteCards).toHaveCount(1)
  await expect(symbolInput).toHaveValue('TEST')
  await page.getByRole('button', { name: '添加行情标的', exact: true }).click()
  await expect(quoteCards).toHaveCount(2)
  await expect(quoteCards.last().locator('.admin-item-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await quoteCards.last().locator('.admin-item-toggle').click()
  await quote(secondQuoteId).locator('.admin-item-toggle').click()
  await page.screenshot({ path: resolve(evidence, 'quote-controls-desktop.png'), fullPage: true })

  await section('常用链接')
  await toggle(link(initial.config.links[0].id), '启用链接 1')
  await expect(link(initial.config.links[0].id).locator('.admin-item-status')).toHaveCount(0)
  await section('数据源')
  const source = page.locator('[data-source-id]').first()
  await expect(source.locator('header')).not.toContainText(/已启用|已停用|已关闭/)
  await expect(source.locator('.source-enable-copy')).toHaveCount(0)
  await toggle(
    source,
    await source.locator('header').getByRole('switch').getAttribute('aria-label'),
  )
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await page
    .getByRole('dialog', { name: '选择数据源类型', exact: true })
    .getByRole('button', { name: /^Sleepy / })
    .click()
  const sleep = page.locator('[data-source-id]').last()
  await sleep.locator('input[aria-label="实例 HTTPS 地址"]').fill('https://fixture.example.com/')
  await sleep.getByRole('button', { name: '确认来源访问', exact: true }).click()
  await page
    .getByRole('dialog', { name: '允许访问此服务？', exact: true })
    .getByRole('button', { name: '确认访问', exact: true })
    .click()
  const revoke = sleep.getByRole('button', { name: '撤销访问批准', exact: true })
  const background = await revoke.evaluate((e) => getComputedStyle(e).backgroundColor)
  assert.ok(!['transparent', 'rgba(0, 0, 0, 0)'].includes(background))
  await sleep.locator('.admin-item-toggle').click()

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    for (const name of ['Dashboard 模块', '行情标的', '常用链接', '数据源']) {
      await section(name)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      const visibleCards = page.locator('fieldset:visible .admin-editor-item')
      for (const header of await visibleCards.locator(':scope > header').all()) {
        const bounds = await header.boundingBox()
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
        const control = header.getByRole('switch').first()
        await expect(control).toBeVisible()
        const box = await control.boundingBox()
        assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width)
        if (!['Dashboard 模块', '行情标的'].includes(name)) {
          const title = await header.locator('.admin-item-toggle').boundingBox()
          assert.ok(Math.abs(box.y + box.height / 2 - title.y - title.height / 2) <= 2)
        }
      }
      await page.screenshot({ path: resolve(evidence, `${name}-${width}.png`), fullPage: true })
    }
  }
  assert.deepEqual(await input(), initial, 'Header operations must remain local drafts')
  assert.deepEqual(errors, [])
}
