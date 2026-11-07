// Runs against the authenticated local Worker and disposable D1 owned by source-access.test.ts.
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'

export async function exerciseDataManagement(page, { request, input, save, evidence }) {
  await mkdir(evidence, { recursive: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const section = async (name) => {
    const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
    if (await trigger.isVisible()) {
      await trigger.click()
      await page
        .getByRole('dialog', { name: '选择管理分区' })
        .getByRole('button', { name, exact: true })
        .click()
    } else await page.getByRole('button', { name, exact: true }).click()
  }
  assert.equal(
    (await request('/api/admin/data/export', 'GET', undefined, { Cookie: '' })).status,
    401,
  )
  await section('数据管理')
  const initial = await input()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出配置', exact: true }).click()
  const file = await downloaded
  const backup = JSON.parse(await readFile(await file.path(), 'utf8'))
  assert.equal(backup.format, 'nozoki-config')
  assert.equal(backup.config.site.siteName, initial.config.site.siteName)
  assert.ok(!JSON.stringify(backup).includes('approvedTarget'))
  const upload = page.getByLabel('选择配置备份文件', { exact: true })
  const choose = async (value) =>
    upload.setInputFiles({
      name: 'nozoki-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    })
  await choose({ version: 99 })
  await expect(page.getByRole('alert').filter({ hasText: '无法读取此配置文件' })).toBeVisible()
  assert.deepEqual(await input(), initial)
  backup.config.site.siteName = 'Imported site fixture'
  await choose(backup)
  const preview = page.getByRole('dialog', { name: '导入配置预览', exact: true })
  await expect(preview).toContainText('Imported site fixture')
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  assert.deepEqual(await input(), initial)
  // A new imported source cannot enter the draft before a real protocol probe succeeds.
  const sleepy = createIntegrationDraft('sleepy', [], 'fixture')
  const {
    credential: _credential,
    access: _access,
    capabilities: _capabilities,
    ...portable
  } = sleepy
  backup.config.integrations.push({
    ...portable,
    id: 'foreign-sleepy',
    enabled: true,
    baseUrl: 'https://imported.example.com/',
  })
  await choose(backup)
  await expect(preview.getByRole('button', { name: '导入到草稿', exact: true })).toBeDisabled()
  await preview.getByRole('button', { name: '测试并确认访问', exact: true }).click()
  await expect(preview.locator('[data-test-status="ok"]')).toBeVisible()
  await expect(preview.getByRole('button', { name: '导入到草稿', exact: true })).toBeEnabled()
  await preview.getByRole('button', { name: '导入到草稿', exact: true }).click()
  await expect(preview).toBeHidden()
  assert.deepEqual(await input(), initial)
  const commit = async () => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    const result = await response
    assert.equal(result.status(), 200, await result.text())
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /配置已保存|已保存并确认持久化/ })
        .first(),
    ).toBeVisible()
  }
  await commit()
  const saved = await input()
  assert.equal(saved.config.site.siteName, 'Imported site fixture')
  assert.ok(saved.config.integrations.some((s) => s.id === 'sleepy'))
  await expect(page.locator('.data-management')).toBeVisible()
  await page.screenshot({ path: resolve(evidence, 'data-management-desktop.png'), fullPage: true })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('button', { name: '恢复全局默认设置', exact: true }).click()
    const reset = page.getByRole('dialog', { name: '恢复全局默认设置？', exact: true })
    await expect(reset).toBeVisible()
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    )
    await page.screenshot({
      path: resolve(evidence, `data-management-${width}.png`),
      fullPage: true,
    })
    await page.keyboard.press('Escape')
    await expect(reset).toBeHidden()
    assert.deepEqual(await input(), saved)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '恢复全局默认设置', exact: true }).click()
  await page
    .getByRole('dialog', { name: '恢复全局默认设置？' })
    .getByRole('button', { name: '确认恢复默认', exact: true })
    .click()
  assert.deepEqual(await input(), saved)
  // The reset still uses the same compare-and-swap save boundary.
  const competing = await input()
  competing.config.site.siteName = 'Concurrent fixture'
  assert.equal((await save(competing)).status, 200)
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await conflict).status(), 409)
  await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).click()
  await page
    .getByRole('dialog', { name: '服务器最新配置' })
    .getByRole('button', { name: '放弃草稿并载入最新', exact: true })
    .click()
  await page.getByRole('button', { name: '恢复全局默认设置', exact: true }).click()
  await page
    .getByRole('dialog', { name: '恢复全局默认设置？' })
    .getByRole('button', { name: '确认恢复默认', exact: true })
    .click()
  await commit()
  const reset = await input()
  assert.equal(reset.config.site.siteName, 'Nozoki')
  assert.equal(reset.config.integrations.find((s) => s.id === 'sleepy').enabled, false)
  assert.deepEqual(errors, [])
}
