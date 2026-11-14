import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect } from 'playwright/test'

export async function exerciseAdminListHeaders(page, { input, save, evidence }) {
  page.setDefaultTimeout(8000)
  await mkdir(evidence, { recursive: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (/hydrat/i.test(message.text()) && ['error', 'warning'].includes(message.type()))
      errors.push(message.text())
  })
  const initial = await input()
  const names = ['站点外观', '主页模块', '来源接入', '数据管理']
  const drawerTrigger = page.getByRole('button', { name: '选择管理分区', exact: true })
  const drawer = page.getByRole('dialog', { name: '选择管理分区' })
  const nav = page.getByRole('navigation', { name: '管理分区' })
  const saveButton = page.getByRole('button', { name: '保存配置', exact: true })
  const list = page.locator('[data-edit-module]')
  const editButton = (id) =>
    list.and(page.locator(`[data-edit-module="${id}"]`)).locator('.admin-item-toggle')
  const editor = (id) => page.locator(`[data-module-editor="${id}"]`)
  const back = page.getByRole('button', { name: '返回模块列表' })
  const heading = page.locator('.admin-section-title h2')
  const section = async (name) => {
    if (await drawerTrigger.isVisible()) {
      await drawerTrigger.click()
      await drawer.getByRole('button', { name, exact: true }).click()
      await expect(drawer).toBeHidden()
    } else await nav.getByRole('button', { name, exact: true }).click()
    await expect(heading).toHaveText(name)
  }
  const edit = async (id) => {
    if (await back.isVisible()) await back.click()
    await editButton(id).click()
    await expect(editor(id)).toBeVisible()
  }
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click()
    await page
      .locator('.var-menu__menu:visible .var-option')
      .filter({ has: page.getByText(option, { exact: true }) })
      .click()
  }
  const shot = (name) =>
    page.screenshot({
      path: resolve(evidence, name + '.png'),
      fullPage: true,
      animations: 'disabled',
    })
  await expect(nav.getByRole('button')).toHaveText(names)
  await section('来源接入')
  await expect(page.getByRole('button', { name: '添加来源', exact: true })).toBeVisible()
  await section('数据管理')
  await section('主页模块')
  await expect(list).toHaveCount(initial.config.modules.length)
  assert.deepEqual(
    await list.evaluateAll((items) => items.map((item) => item.dataset.editModule)),
    initial.config.modules.map((item) => item.id),
  )
  await expect(list.getByRole('button', { name: /上移|下移/ })).toHaveCount(0)
  await shot('modules-1440')
  const configCalls = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/config') configCalls.push(request.method())
  })
  await editButton('deepseek').focus()
  await page.keyboard.press('Enter')
  await expect(heading).toBeFocused()
  const longTitle = '深度求索余额及使用趋势的自定义中文模块标题'.repeat(3)
  await page.getByRole('textbox', { name: 'deepseek 标题', exact: true }).fill(longTitle)
  await page.getByRole('switch', { name: 'DeepSeek 未登录时模糊展示' }).click()
  await page.goBack()
  await expect(editButton('deepseek')).toBeFocused()
  await page.goForward()
  await expect(heading).toHaveText(longTitle)
  await edit('devices')
  await editor('devices').locator('summary').click()
  await choose('添加字段规则', '/devices/*/batteryPercent')
  await editor('devices').getByRole('button', { name: '添加权限规则', exact: true }).click()
  await edit('tailscale')
  await choose('Tailscale IP 显示', '访客隐藏')
  await choose('Tailscale 访客节点名称', '遮蔽')
  await edit('codex')
  await choose('Codex 左侧圆环', '5 小时重置进度')
  await choose('访客：5 小时重置进度', '隐藏')
  await shot('codex-1440')
  await edit('activity')
  const start = page.getByLabel('上班时间 HH:mm', { exact: true })
  await start.fill('09:00')
  const labels = page.getByRole('button', { name: '自定义状态文案', exact: true })
  await labels.click()
  await expect(page.getByRole('dialog', { name: '自定义状态文案' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(labels).toBeFocused()
  await expect(page.getByRole('region', { name: '日程预览' })).toBeVisible()
  await edit('quotes')
  const quotes = editor('quotes').locator('[data-edit-quote]')
  await page.getByRole('button', { name: '添加行情标的' }).click()
  const quoteIndex = initial.config.quotes.length + 1
  await expect(quotes).toHaveCount(quoteIndex)
  await expect(quotes.last().locator('.admin-item-toggle')).toHaveAttribute('aria-expanded', 'true')
  await quotes.last().locator(`input[aria-label="标的 ${quoteIndex} 代码"]`).fill('MSFT')
  await quotes.last().getByRole('button', { name: '上移标的 MSFT' }).click()
  await expect(quotes.nth(quoteIndex - 2)).toContainText('MSFT')
  await quotes
    .nth(quoteIndex - 2)
    .getByRole('button', { name: '移除标的 MSFT' })
    .click()
  await expect(quotes).toHaveCount(initial.config.quotes.length)
  await quotes.first().locator('.admin-item-toggle').click()
  await quotes.first().locator('input[aria-label="标的 1 名称"]').fill('行情编辑回归')
  await edit('links')
  const links = editor('links').locator('[data-edit-link]')
  await links.last().locator('.admin-item-toggle').click()
  await links
    .last()
    .getByRole('button', { name: `删除链接 ${initial.config.links.length}` })
    .click()
  await page.getByRole('button', { name: '添加链接', exact: true }).click()
  await expect(links).toHaveCount(initial.config.links.length)
  await links
    .last()
    .locator(`input[aria-label="链接 ${initial.config.links.length} 名称"]`)
    .fill('新链接回归')
  await choose(`链接 ${initial.config.links.length} 权限`, '管理员')
  await links
    .last()
    .getByRole('button', { name: `上移链接 ${initial.config.links.length}` })
    .click()
  await expect(links.nth(initial.config.links.length - 2)).toContainText('新链接回归')
  await edit('services')
  const choices = editor('services').getByRole('checkbox')
  await expect(choices).toHaveCount(8)
  await choices.last().uncheck()
  const serviceOrder = page.getByRole('list', { name: '首页服务列表' })
  const firstService = await serviceOrder
    .getByRole('listitem')
    .first()
    .locator('strong')
    .innerText()
  await serviceOrder.getByRole('button', { name: `下移服务 ${firstService}` }).click()
  await expect(serviceOrder.getByRole('listitem').nth(1)).toContainText(firstService)
  await edit('activity')
  await expect(start).toHaveValue('09:00')
  await back.click()
  const activityToggle = list
    .and(page.locator('[data-edit-module="activity"]'))
    .getByRole('switch', { name: '启用 activity' })
  await expect(activityToggle).toBeChecked()
  await activityToggle.click()
  await expect(activityToggle).not.toBeChecked()
  await edit('activity')
  const activityEditorToggle = page.getByRole('switch', { name: '启用 activity' })
  await expect(activityEditorToggle).not.toBeChecked()
  await activityEditorToggle.click()
  await edit('deepseek')
  await expect(heading).toHaveText(longTitle)
  assert.deepEqual(configCalls, [])
  assert.deepEqual(await input(), initial)

  const keys = []
  await page.route('**/api/admin/config', async (route) => {
    if (route.request().method() === 'PUT') {
      keys.push(route.request().headers()['idempotency-key'])
      if (keys.length === 1) return route.abort('failed')
    }
    await route.continue()
  })
  await saveButton.click()
  await expect(page.getByText(/未能确认保存结果/)).toBeVisible()
  await expect(heading).toHaveText(longTitle)
  const nextPut = () =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/config' &&
        response.request().method() === 'PUT',
    )
  const savedResponse = nextPut()
  await saveButton.click()
  assert.equal((await savedResponse).status(), 200)
  await expect(page.getByText(/配置已保存|已保存并确认持久化/)).toBeVisible()
  assert.ok(keys[0])
  assert.equal(keys[0], keys[1])
  const saved = await input()
  const byId = (id) => saved.config.modules.find((item) => item.id === id)
  assert.equal(byId('deepseek').title, longTitle)
  assert.equal(byId('codex').presentation.codex.slots[0], 'fiveHourResetProgress')
  assert.equal(byId('codex').presentation.codex.guest.fiveHourResetProgress, 'hidden')
  assert.equal(byId('tailscale').presentation.tailnetName, 'masked')
  assert.ok('/devices/*/batteryPercent' in byId('devices').fields)
  assert.equal(byId('services').homeServices.length, 7)
  assert.equal(saved.config.site.schedule.start, '09:00')
  assert.equal(saved.config.quotes[0].displayName, '行情编辑回归')
  assert.ok(
    saved.config.links.some((link) => link.title === '新链接回归' && link.visibility === 'admin'),
  )
  await page.reload()
  await expect(editor('deepseek')).toBeVisible()
  await expect(heading).toHaveText(longTitle)

  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height })
    const saveBounds = await saveButton.boundingBox()
    assert.ok(saveBounds && saveBounds.x >= 0 && saveBounds.x + saveBounds.width <= width)
    if (width < 901) {
      await drawerTrigger.click()
      await expect(drawer.getByRole('button')).toHaveText(names)
      if (width === 390) {
        await expect(drawer).toBeInViewport({ ratio: 0.9 })
        await shot('drawer-390')
        await drawer.getByRole('button', { name: '站点外观', exact: true }).click()
        await expect(heading).toHaveText('站点外观')
        await section('主页模块')
        await edit('deepseek')
        await drawerTrigger.click()
      }
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      await expect(drawerTrigger).toBeFocused()
    }
    for (const id of [
      'deepseek',
      'activity',
      'quotes',
      'links',
      'services',
      'codex',
      'tailscale',
      'devices',
    ]) {
      if (id !== 'deepseek') await edit(id)
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${id} at ${width}`,
      )
    }
    await edit('deepseek')
    await shot(`module-${width}`)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  const more = page.getByRole('button', { name: '更多管理操作', exact: true })
  await more.click()
  await page.getByRole('menuitem', { name: /切换到.*色模式/ }).click()
  await expect(editor('deepseek')).toBeVisible()
  await shot('module-alternate-theme')
  const draftTitle = page.getByRole('textbox', { name: 'deepseek 标题', exact: true })
  await draftTitle.fill('冲突测试草稿')
  const leaving = page.waitForEvent('dialog')
  const reload = page.reload().catch(() => {})
  const leavePrompt = await leaving
  assert.equal(leavePrompt.type(), 'beforeunload')
  await leavePrompt.dismiss()
  await reload
  await expect(draftTitle).toHaveValue('冲突测试草稿')
  const concurrent = await input()
  concurrent.config.site.siteName = '隔离库并发修改'
  assert.equal((await save(concurrent)).status, 200)
  const conflict = nextPut()
  await saveButton.click()
  assert.equal((await conflict).status(), 409)
  await expect(page.getByText(/草稿已保留，请读取最新版本/)).toBeVisible()
  await expect(draftTitle).toHaveValue('冲突测试草稿')
  assert.equal((await input()).config.site.siteName, '隔离库并发修改')

  await more.click()
  await page.getByRole('menuitem', { name: '放弃修改' }).click()
  await page.getByRole('button', { name: '确认放弃' }).click()
  await expect(draftTitle).toHaveValue(longTitle)

  await draftTitle.fill('过期会话草稿')
  await page.context().clearCookies()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForURL('**/login')
  await expect(page.locator('.admin-page')).toHaveCount(0)
  assert.equal(
    (await page.request.get(new URL('/api/admin/config', page.url()).href)).status(),
    401,
  )
  assert.deepEqual(errors, [])
}
