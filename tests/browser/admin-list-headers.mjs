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
  await page.screenshot({ path: resolve(evidence, 'module-headers-desktop.png'), fullPage: true })

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

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    for (const name of ['Dashboard 模块', '常用链接', '数据源']) {
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
        if (name !== 'Dashboard 模块') {
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
