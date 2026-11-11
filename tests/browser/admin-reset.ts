import assert from 'node:assert/strict'
import { expect } from 'playwright/test'

/** Uses the isolated HTTP test database; never writes demo settings to the daily database. */
export async function exerciseSectionResets(page, context, origin) {
  const before = await (await context.request.get(origin + '/api/admin/config')).json()
  let writes = 0
  const countWrites = (request) => {
    if (request.url().endsWith('/api/admin/config') && request.method() === 'PUT') writes++
  }
  page.on('request', countWrites)
  const go = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('.admin-section-heading h2')).toHaveText(label)
  }
  const open = async (label) => {
    await page.getByRole('button', { name: `重置${label}为默认设置`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `恢复${label}默认设置？` })
    await expect(dialog).toBeVisible()
    return dialog
  }
  const reset = async (label) => {
    const dialog = await open(label)
    await dialog.getByRole('button', { name: '恢复默认', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  const items = () => page.locator('fieldset:visible .admin-editor-item')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByLabel('站点名称', { exact: true }).fill('Reset cancellation draft')
  const dialog = await open('站点与外观')
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '恢复默认', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: '重置站点与外观为默认设置' })).toBeFocused()
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('Reset cancellation draft')
  await reset('站点与外观')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('Nozoki')
  await page.getByLabel('站点名称', { exact: true }).fill('Keep unrelated draft')

  await go('常用链接')
  await items().first().locator('.admin-item-toggle').click()
  await page.getByLabel('链接 1 名称', { exact: true }).fill('Temporary link')
  await reset('常用链接')
  await expect(items()).toHaveCount(4)
  await items().first().locator('.admin-item-toggle').click()
  await expect(page.getByLabel('链接 1 名称', { exact: true })).toHaveValue('博客')

  await go('行情标的')
  await page.getByRole('button', { name: '添加行情标的', exact: true }).click()
  await expect(items()).toHaveCount(3)
  await reset('行情标的')
  await expect(items()).toHaveCount(2)

  await go('日程安排')
  await page.getByLabel('IANA 时区', { exact: true }).fill('Europe/London')
  await page.getByLabel('上班时间 HH:mm', { exact: true }).fill('09:15')
  await reset('日程安排')
  await expect(page.getByLabel('IANA 时区', { exact: true })).toHaveValue('Asia/Shanghai')
  await expect(page.getByLabel('上班时间 HH:mm', { exact: true })).toHaveValue('08:30')

  await go('Dashboard 模块')
  const deepseek = page.locator('[data-edit-module="deepseek"]')
  const codex = page.locator('[data-edit-module="codex"]')
  await deepseek.locator('.admin-item-toggle').click()
  await page.getByLabel('deepseek 标题', { exact: true }).fill('Temporary module')
  await codex.locator('.admin-item-toggle').click()
  await expect(codex).toContainText('自动匹配：CLIProxyAPI')
  await go('数据源')
  await reset('数据源')
  await expect(items()).toHaveCount(0)
  await go('Dashboard 模块')
  await expect(page.getByLabel('deepseek 标题', { exact: true })).toHaveValue('Temporary module')
  await expect(codex).toContainText('添加对应类型的数据源后自动匹配')
  await reset('Dashboard 模块')
  await deepseek.locator('.admin-item-toggle').click()
  await expect(page.getByLabel('deepseek 标题', { exact: true })).toHaveValue('DeepSeek')

  await go('站点与外观')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('Keep unrelated draft')
  assert.equal(writes, 0, 'confirming a reset must not immediately save')
  const stored = await (await context.request.get(origin + '/api/admin/config')).json()
  assert.deepEqual(stored, before, 'server configuration changed before Save')

  await page.setViewportSize({ width: 320, height: 844 })
  const mobile = await open('站点与外观')
  await mobile.getByRole('button', { name: '取消', exact: true }).click()
  await expect(mobile).toBeHidden()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '放弃修改', exact: true }).click()
  await page.getByRole('button', { name: '确认放弃', exact: true }).click()
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue(before.site.siteName)
  page.off('request', countWrites)
}

export async function verifyResetSave(page, context, origin) {
  const current = await (await context.request.get(origin + '/api/admin/config')).json()
  await page.getByRole('button', { name: '常用链接', exact: true }).click()
  await page.locator('fieldset:visible .admin-item-toggle').first().click()
  await page.getByLabel('链接 1 名称', { exact: true }).fill('Persisted custom link')
  const save = async () => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    assert.equal((await response).status(), 200)
    await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled()
    await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
  }
  await save()
  await page.getByRole('button', { name: '重置常用链接为默认设置', exact: true }).click()
  await page
    .getByRole('dialog', { name: '恢复常用链接默认设置？' })
    .getByRole('button', { name: '恢复默认', exact: true })
    .click()
  await save()
  await page.reload()
  const persisted = await (await context.request.get(origin + '/api/admin/config')).json()
  assert.equal(persisted.links[0].title, '博客')
  assert.deepEqual(persisted.site.schedule, current.site.schedule)
  assert.deepEqual(persisted.integrations, current.integrations)
  assert.deepEqual(persisted.modules, current.modules)
  assert.deepEqual(persisted.quotes, current.quotes)
}
