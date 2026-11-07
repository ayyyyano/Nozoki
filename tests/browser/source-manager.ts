// Uses only the caller's authenticated, isolated fixture Worker and mock upstream.
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function exerciseSourceManager(page, { input, save, deepId, evidence, db }) {
  await mkdir(evidence, { recursive: true })
  const errors = []
  const measurements = []
  const measure = async (label) => {
    measurements.push(
      await page.evaluate(
        (label) => ({
          label,
          viewport: { width: innerWidth, height: innerHeight },
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          sources: [...document.querySelectorAll('[data-source-id]')].map((e) => {
            const b = e.getBoundingClientRect()
            return { id: e.dataset.sourceId, x: b.x, width: b.width, height: b.height }
          }),
        }),
        label,
      ),
    )
  }
  page.on('pageerror', (e) => errors.push(e.message))
  const settleDialog = async (dialog) => {
    await expect(dialog).toBeVisible()
    await dialog.evaluate(async (el) => {
      await new Promise(requestAnimationFrame)
      for (let node = el; node; node = node.parentElement)
        await Promise.all(
          node
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        )
    })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const section = async () => {
    const drawer = page.getByRole('button', { name: '选择管理分区', exact: true })
    if (await drawer.isVisible()) {
      await drawer.click()
      await page
        .getByRole('dialog', { name: '选择管理分区' })
        .getByRole('button', { name: '数据源', exact: true })
        .click()
    } else await page.getByRole('button', { name: '数据源', exact: true }).click()
  }
  const card = (id) => page.locator(`[data-source-id="${id}"]`)
  const expand = async (id) => {
    const c = card(id)
    if ((await c.locator('.admin-item-toggle').getAttribute('aria-expanded')) !== 'true')
      await c.locator('.admin-item-toggle').click()
    return c
  }
  const commit = async () => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    const r = await response
    assert.equal(r.status(), 200, await r.text())
    await expect(page.getByText(/^(?:已保存并确认持久化|配置已保存，)/).first()).toBeVisible()
  }
  await section()
  const initial = await input()
  await measure('desktop-list')
  await page.screenshot({ path: resolve(evidence, 'sources-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '切换到暗色模式', exact: true }).click()
  await page.screenshot({ path: resolve(evidence, 'sources-desktop-dark.png'), fullPage: true })
  await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '切换到亮色模式', exact: true }).click()
  for (const label of [
    'Provider',
    '协议版本',
    '来源 ID',
    '凭据操作',
    '上游认证方式',
    '能力名称',
    '上游字段路径',
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择数据源类型', exact: true })
  await settleDialog(picker)
  await page.screenshot({ path: resolve(evidence, 'provider-picker.png') })
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(page.getByRole('button', { name: '添加来源', exact: true })).toBeFocused()
  assert.deepEqual((await input()).config.integrations, initial.config.integrations)

  const first = await expand('fixture')
  await first.getByRole('switch').click()
  await expect(first.getByRole('switch')).not.toBeChecked()
  await expect(first.locator('.source-enable-copy')).toHaveCount(0)
  await first.getByRole('switch').click()
  const deep = await expand(deepId)
  await expect(deep.getByText('已配置', { exact: true })).toBeVisible()
  await expect(deep.locator('.source-credential input')).toHaveCount(0)
  await deep.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(deep.locator('input[aria-label="新 API Key"]')).toHaveValue('')
  await deep.getByRole('button', { name: '取消编辑', exact: true }).click()
  await deep.getByRole('button', { name: '删除API Key', exact: true }).click()
  const clear = page.getByRole('dialog', { name: '清除API Key？', exact: true })
  await page.keyboard.press('Escape')
  await expect(clear).toBeHidden()
  await deep.getByRole('button', { name: '删除API Key', exact: true }).click()
  await clear.getByRole('button', { name: '确认清除', exact: true }).click()
  await expect(deep.getByText('API Key · 保存后清除', { exact: true })).toBeVisible()
  await deep.getByRole('button', { name: '撤销删除', exact: true }).click()
  await deep.getByRole('button', { name: '编辑', exact: true }).click()
  const prove = async () => {
    await db.prepare('DELETE FROM login_limits').run()
    await deep.getByRole('button', { name: '测试并确认访问', exact: true }).click()
    await expect(deep.locator('[data-test-status="ok"]')).toBeVisible()
  }
  const newKey = 'SYNTHETIC-UI-REPLACEMENT'
  await deep.locator('input[aria-label="新 API Key"]').fill(newKey)
  await expect(deep.getByRole('button', { name: '测试并确认访问', exact: true })).toBeEnabled()
  await expect(deep.locator('input[aria-label="新 API Key"]')).toHaveAttribute('type', 'password')
  await deep.getByRole('button', { name: '显示新API Key', exact: true }).click()
  await expect(deep.locator('input[aria-label="新 API Key"]')).toHaveAttribute('type', 'text')
  await page.screenshot({ path: resolve(evidence, 'credential-edit-desktop.png') })
  // A real competing save returns CAS conflict and retains the typed replacement.
  const competing = await input()
  competing.config.site.siteName = 'Source manager competing fixture'
  assert.equal((await save(competing)).status, 200)
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await conflict).status(), 409)
  await expect(deep.locator('input[aria-label="新 API Key"]')).toHaveValue(newKey)
  await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).click()
  await page
    .getByRole('dialog', { name: '服务器最新配置', exact: true })
    .getByRole('button', { name: '保留草稿', exact: true })
    .click()
  await expect(deep.locator('input[aria-label="新 API Key"]')).toHaveValue(newKey)
  await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).click()
  await page
    .getByRole('dialog', { name: '服务器最新配置', exact: true })
    .getByRole('button', { name: '放弃草稿并载入最新', exact: true })
    .click()
  await expand(deepId)
  await deep.getByRole('button', { name: '编辑', exact: true }).click()
  await deep.locator('input[aria-label="新 API Key"]').fill(newKey)
  await prove()
  await commit()
  await expect(deep.locator('.source-credential input')).toHaveCount(0)
  assert.ok(!JSON.stringify(await input()).includes(newKey))
  await deep.getByRole('button', { name: '删除API Key', exact: true }).click()
  await clear.getByRole('button', { name: '确认清除', exact: true }).click()
  await commit()
  assert.equal(
    (await input()).config.integrations.find((s) => s.id === deepId).credential.operation,
    'keep',
  )
  // The new empty input is not a returned secret; restore the fixture account for the remaining tests.
  await deep.locator('input[aria-label="API Key"]').fill(newKey)
  await prove()
  await commit()

  await deep.getByRole('button', { name: '删除来源', exact: true }).click()
  const removal = page.getByRole('dialog', { name: '删除 DeepSeek？', exact: true })
  await expect(removal.getByRole('button', { name: '删除来源', exact: true })).toBeDisabled()
  await expect(removal.getByText(/受保护的历史数据/)).toBeVisible()
  await page.keyboard.press('Escape')

  // Existing singleton types are disabled; unadded types open cancellable local forms.
  for (const [name, label] of [
    ['Tailscale', 'OAuth Client ID'],
    ['Uptime Kuma', '状态页标识（slug）'],
    ['Yahoo 行情', null],
  ]) {
    await page.getByRole('button', { name: '添加来源', exact: true }).click()
    await picker.getByRole('button').filter({ hasText: name }).click()
    const dialog = page.getByRole('dialog', { name: '配置 ' + name, exact: true })
    await settleDialog(dialog)
    if (label) await expect(dialog.getByRole('textbox', { name: label, exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '添加来源', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: '添加来源', exact: true })).toBeFocused()
  }
  // Both saved scopes now use human-readable presets; the existing ID stays unchanged.
  await expand('fixture')
  await first.locator('input[aria-label="刷新间隔（秒）"]').fill('75')
  await commit()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: '添加来源', exact: true }).click()
    await expect(picker).toBeVisible()
    await settleDialog(picker)
    const box = await picker.boundingBox()
    measurements.push({ label: 'provider-picker', viewport: { width, height: 900 }, box })
    assert.ok(box.x >= 0 && box.x + box.width <= width)
    await page.keyboard.press('Tab')
    assert.ok(await picker.evaluate((e) => e.contains(document.activeElement)))
    await page.screenshot({ path: resolve(evidence, `provider-picker-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(page.getByRole('button', { name: '添加来源', exact: true })).toBeFocused()
    await expand('fixture')
    await first.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await measure('source-editor')
    await page.screenshot({ path: resolve(evidence, `source-editor-${width}.png`) })
  }
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(evidence, 'measurements.json'),
    JSON.stringify(
      { fixture: true, browser: page.context().browser().version(), errors, measurements },
      null,
      2,
    ) + '\n',
  )
}
