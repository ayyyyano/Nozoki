import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
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
  const seed = await input()
  const devices = seed.config.modules.find((item) => item.id === 'devices')
  devices.visibility = 'public'
  devices.fields['/devices/*/batteryPercent'] = {
    enabled: true,
    visibility: 'admin',
  }
  assert.equal((await save(seed)).status, 200)
  await page.reload()
  const initial = await input()
  const names = ['站点外观', '主页模块', '来源接入', '数据管理']
  const drawerTrigger = page.getByRole('button', { name: '选择管理分区', exact: true })
  const drawer = page.getByRole('dialog', { name: '选择管理分区' })
  const nav = page.getByRole('navigation', { name: '管理分区' })
  const list = page.locator('[data-edit-module]')
  const editButton = (id) =>
    list.and(page.locator(`[data-edit-module="${id}"]`)).locator('.admin-item-toggle')
  const editor = (id) => page.locator(`[data-module-editor="${id}"]`)
  const modal = page.locator('.admin-edit-dialog:visible')
  const saveButton = modal.getByRole('button', { name: '保存配置', exact: true })
  const back = modal.getByRole('button', { name: '关闭对话框' })
  const dialogHeading = modal.getByRole('heading', { level: 2 })
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
      animations: 'disabled',
    })
  await expect(nav.getByRole('button')).toHaveText(names)
  await section('来源接入')
  await expect(page.getByRole('button', { name: '添加来源', exact: true })).toBeVisible()
  const source = page.locator('[data-source-id="sleepy-fixture"] .admin-item-toggle')
  const sourceHeight = (await source.boundingBox()).height
  await section('数据管理')
  await section('主页模块')
  await expect(list).toHaveCount(initial.config.modules.length)
  assert.equal((await editButton('deepseek').boundingBox()).height, sourceHeight)
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
  await expect(modal).toBeVisible()
  await expect.poll(() => modal.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await expect(page.locator('#main-content')).toHaveAttribute('aria-hidden', 'true')
  const longTitle = '深度求索余额及使用趋势的自定义中文模块标题'.repeat(3)
  await page.getByRole('textbox', { name: 'deepseek 标题', exact: true }).fill(longTitle)
  await expect(page.getByRole('switch', { name: /模糊展示余额/ })).toHaveCount(0)
  await expect(page.getByLabel('deepseek 访客行为')).toHaveCount(0)
  await page.goBack()
  await expect(editButton('deepseek')).toBeFocused()
  await page.goForward()
  await expect(dialogHeading).toHaveText(longTitle)
  await edit('devices')
  await expect(
    editor('devices').getByText(/旧版高级限制|\/devices\/\*\/batteryPercent/),
  ).toHaveCount(0)
  await expect(editor('devices').getByLabel('添加字段规则')).toHaveCount(0)
  const devicesPrivacy = editor('devices').getByRole('switch', { name: '访客隐藏设备应用与状态' })
  await devicesPrivacy.press('Space')
  await expect(devicesPrivacy).toBeChecked()
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
  const addDate = page.getByRole('button', { name: '添加特殊日期', exact: true })
  await addDate.click()
  const dateDialog = page.getByRole('dialog', { name: '添加特殊日期', exact: true })
  await dateDialog.getByLabel('日期', { exact: true }).fill('2026-12-12')
  await dateDialog.getByRole('button', { name: '应用', exact: true }).click()
  await expect(editor('activity')).toContainText('2026-12-12')
  await edit('quotes')
  const quotes = editor('quotes').locator('[data-edit-quote]')
  const originalQuotes = initial.config.quotes.length
  const quoteIndex = originalQuotes + 1
  const addQuote = page.getByRole('button', { name: '添加行情标的', exact: true })
  const newQuote = page.getByRole('dialog', { name: '添加行情标的', exact: true })
  const editQuote = page.getByRole('dialog', { name: '编辑行情标的', exact: true })
  await addQuote.click()
  await newQuote.getByRole('textbox', { name: `标的 ${quoteIndex} 代码` }).fill('MSFT')
  await newQuote.getByRole('button', { name: '取消', exact: true }).click()
  await expect(addQuote).toBeFocused()
  await expect(quotes).toHaveCount(originalQuotes)
  await addQuote.click()
  await newQuote.getByRole('textbox', { name: `标的 ${quoteIndex} 代码` }).fill('MSFT')
  await newQuote.getByRole('button', { name: '应用', exact: true }).click()
  await expect(quotes).toHaveCount(quoteIndex)
  await quotes.last().getByRole('button', { name: '上移标的 MSFT' }).click()
  await expect(quotes.nth(quoteIndex - 2)).toContainText('MSFT')
  await quotes
    .nth(quoteIndex - 2)
    .getByRole('button', { name: '编辑标的 MSFT' })
    .click()
  await editQuote.getByRole('button', { name: '移除标的', exact: true }).click()
  await expect(quotes).toHaveCount(originalQuotes)
  await quotes
    .first()
    .getByRole('button', { name: /^编辑标的/ })
    .click()
  await editQuote.getByRole('textbox', { name: '标的 1 名称', exact: true }).fill('行情编辑回归')
  await editQuote.getByRole('button', { name: '应用', exact: true }).click()
  await edit('links')
  const links = editor('links').locator('[data-edit-link]')
  const linkCount = initial.config.links.length
  const editLink = page.getByRole('dialog', { name: '编辑链接', exact: true })
  const newLink = page.getByRole('dialog', { name: '添加链接', exact: true })
  await links
    .last()
    .getByRole('button', { name: `编辑链接 ${linkCount}` })
    .click()
  await editLink.getByRole('button', { name: '删除链接', exact: true }).click()
  await page.getByRole('button', { name: '添加链接', exact: true }).click()
  await newLink
    .getByRole('textbox', { name: `链接 ${linkCount} 名称`, exact: true })
    .fill('新链接回归')
  await choose(`链接 ${linkCount} 权限`, '管理员')
  await newLink.getByRole('button', { name: '应用', exact: true }).click()
  await expect(links).toHaveCount(linkCount)
  await links
    .last()
    .getByRole('button', { name: `上移链接 ${linkCount}` })
    .click()
  await expect(links.nth(linkCount - 2)).toContainText('新链接回归')
  await edit('services')
  const choices = editor('services').getByRole('checkbox')
  await expect(choices).toHaveCount(8)
  await choices.nth(7).uncheck()
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
  const activityEditorToggle = modal.getByRole('switch', { name: '启用 activity' })
  await expect(activityEditorToggle).not.toBeChecked()
  await activityEditorToggle.click()
  await edit('deepseek')
  await expect(dialogHeading).toHaveText(longTitle)
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
  await expect(dialogHeading).toHaveText(longTitle)
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
  assert.deepEqual(byId('devices').fields['/devices/*/batteryPercent'], {
    enabled: true,
    visibility: 'admin',
  })
  assert.deepEqual(byId('devices').fields.stateText, { enabled: true, visibility: 'admin' })
  assert.deepEqual(
    byId('activity').fields,
    initial.config.modules.find((m) => m.id === 'activity').fields,
  )
  assert.equal(byId('services').homeServices.length, 7)
  assert.equal(saved.config.site.schedule.start, '09:00')
  assert.equal(saved.config.quotes[0].displayName, '行情编辑回归')
  assert.ok(
    saved.config.links.some((link) => link.title === '新链接回归' && link.visibility === 'admin'),
  )
  await page.reload()
  await expect(editor('deepseek')).toBeVisible()
  await expect(dialogHeading).toHaveText(longTitle)

  const dashboardUrl = new URL('/api/dashboard', page.url()).href
  const getDevice = async (request) => {
    const view = await (await request.get(dashboardUrl)).json()
    return view.modules.find((m) => m.id === 'devices').snapshot.data.devices[0]
  }
  const guest = await page.context().browser().newContext()
  try {
    assert.equal((await getDevice(page.request)).batteryPercent, 0)
    assert.ok((await getDevice(guest.request)).batteryPercent == null)
    const publicView = await (await guest.request.get(dashboardUrl)).json()
    const deepseekView = publicView.modules.find((item) => item.id === 'deepseek')
    assert.deepEqual(deepseekView.snapshot.data, { masked: true })
    const publicPage = await guest.newPage()
    await publicPage.setViewportSize({ width: 1440, height: 900 })
    await publicPage.goto(new URL('/', dashboardUrl).href)
    const hint = publicPage.locator('[data-module="codex"] .module-body')
    await expect(hint.getByRole('link', { name: '登录后查看' })).toBeVisible()
    assert.ok(
      await hint.evaluate((body) => {
        const area = body.getBoundingClientRect()
        const link = body.querySelector('a')!.getBoundingClientRect()
        return (
          Math.abs(area.x + area.width / 2 - link.x - link.width / 2) < 1 &&
          Math.abs(area.y + area.height / 2 - link.y - link.height / 2) < 1
        )
      }),
    )
    await expect(publicPage.locator('[data-module="deepseek"] .balance-private')).toContainText(
      '登录后查看',
    )
  } finally {
    await guest.close()
  }

  async function settingRow(row) {
    const bounds = await row.evaluate((control) => {
      const text = control.querySelector('span')!
      const toggle = control.querySelector('.var-switch')!
      const rect = (el: Element) => el.getBoundingClientRect().toJSON()
      return { row: rect(control), label: rect(text), toggle: rect(toggle) }
    })
    assert.ok(bounds.row.height >= 44)
    assert.ok(bounds.label.right + 11 <= bounds.toggle.left)
    assert.ok(Math.abs(bounds.row.right - bounds.toggle.right) <= 1)
    assert.ok(
      Math.abs(
        bounds.label.top + bounds.label.height / 2 - (bounds.toggle.top + bounds.toggle.height / 2),
      ) <= 1,
    )
    return bounds
  }

  const sourceFooter = modal.locator('footer')
  async function sourceActions() {
    const bounds = await sourceFooter.evaluate((footer) => {
      const remove = footer.querySelector('.source-remove-action')!
      const save = footer.querySelector('.admin-editor-save-button')!
      const rect = (el: Element) => el.getBoundingClientRect().toJSON()
      const style = getComputedStyle(footer)
      return {
        footer: rect(footer),
        remove: rect(remove),
        save: rect(save),
        removeColor: getComputedStyle(remove).backgroundColor,
        saveColor: getComputedStyle(save).backgroundColor,
        inlinePadding: parseFloat(style.paddingInlineStart),
        blockInsets:
          parseFloat(style.paddingTop) +
          parseFloat(style.paddingBottom) +
          parseFloat(style.borderTopWidth),
        feedback: !!footer.querySelector('.admin-editor-save-state')?.getClientRects().length,
      }
    })
    assert.ok(Math.abs(bounds.remove.top - bounds.save.top) <= 1)
    assert.ok(bounds.remove.right + 8 <= bounds.save.left)
    assert.ok(Math.abs(bounds.remove.left - bounds.footer.left - bounds.inlinePadding) <= 1)
    assert.ok(Math.abs(bounds.footer.right - bounds.save.right - bounds.inlinePadding) <= 1)
    if (!bounds.feedback)
      assert.ok(Math.abs(bounds.footer.height - bounds.save.height - bounds.blockInsets) <= 1)
    assert.notEqual(bounds.removeColor, bounds.saveColor)
    return bounds
  }

  const measurements = []
  async function measure(name: string) {
    await expect(modal).toBeVisible()
    const result = await modal.evaluate(async (panel) => {
      const frame = panel.closest('.var-popup')!
      for (let node: Element | null = panel; node; node = node.parentElement) {
        await Promise.all(
          node.getAnimations().map((animation) => animation.finished.catch(() => {})),
        )
      }
      const rect = (el: Element) => el.getBoundingClientRect().toJSON()
      const header = panel.querySelector('header')!
      const body = panel.querySelector('.admin-edit-dialog-body')!
      const footer = panel.querySelector('footer')!
      const scrim = frame.querySelector('.admin-edit-scrim')!
      const panelStyle = getComputedStyle(panel)
      return {
        viewport: [innerWidth, innerHeight],
        frame: rect(frame),
        panel: rect(panel),
        header: rect(header),
        body: rect(body),
        footer: rect(footer),
        bodyScroll: [body.scrollWidth - body.clientWidth, body.scrollHeight - body.clientHeight],
        scrim: rect(scrim),
        scrimColor: getComputedStyle(scrim).backgroundColor,
        radius: Number.parseFloat(panelStyle.borderTopLeftRadius),
        shadow: panelStyle.boxShadow,
        surface: panelStyle.backgroundColor,
      }
    })
    const { panel, frame, scrim, body, footer, header, viewport, bodyScroll } = result
    const [width, height] = viewport
    const message = `${name} ${width}×${height} ${JSON.stringify(result)}`
    const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1.5, message)
    const inlineGap = width <= 429 ? 12 : 16
    const widthLimit = width >= 1024 ? (name === 'sleepy' ? 760 : 920) : width < 768 ? 480 : width
    near(panel.width, Math.min(frame.width - 2 * inlineGap, widthLimit))
    near(panel.left - frame.left, frame.right - panel.right)
    near(panel.top, height - panel.bottom)
    assert.ok(panel.top >= 15 && panel.bottom <= height - 15, message)
    assert.ok(panel.left >= inlineGap - 1 && panel.right <= width - inlineGap + 1, message)
    near(header.bottom, body.top)
    near(body.bottom, footer.top)
    near(footer.bottom, panel.bottom - 1)
    near(scrim.left, 0)
    near(scrim.top, 0)
    near(scrim.right, frame.right)
    near(scrim.bottom, height)
    assert.match(result.scrimColor, /rgba\(0, 0, 0, 0\.52\)/)
    assert.ok(result.radius >= 20 && result.shadow !== 'none', message)
    assert.notEqual(result.surface, 'rgba(0, 0, 0, 0)', message)
    assert.ok(bodyScroll[0] <= 1, message)
    measurements.push({ name, ...result })
    return result
  }

  const titleInput = page.getByRole('textbox', { name: 'deepseek 标题', exact: true })
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [430, 932],
    [390, 844],
    [375, 812],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height })
    await back.click()
    if (width < 901) {
      await drawerTrigger.click()
      await expect(drawer.getByRole('button')).toHaveText(names)
      if (width === 390) {
        await expect(drawer).toBeInViewport({ ratio: 0.9 })
        await shot('drawer-390')
        await drawer.getByRole('button', { name: '站点外观', exact: true }).click()
        await expect(heading).toHaveText('站点外观')
        await section('主页模块')
        await drawerTrigger.click()
      }
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      await expect(drawerTrigger).toBeFocused()
    }
    await section('来源接入')
    await source.click()
    const sleepy = await measure('sleepy')
    await sourceActions()
    assert.ok(sleepy.panel.height < height * 0.75 && sleepy.bodyScroll[1] === 0)
    if ([1440, 768, 390, 320].includes(width)) await shot(`sleepy-${width}`)
    if (width === 1440) await page.mouse.click(8, 8)
    else await back.click()
    await expect(source).toBeFocused()
    if (width === 390) {
      await page.getByRole('button', { name: '添加来源', exact: true }).click()
      await page
        .getByRole('dialog', { name: '选择数据源类型' })
        .getByRole('button', { name: /Tailscale/ })
        .click()
      const candidate = page.getByRole('dialog', { name: '配置 Tailscale' })
      await expect(candidate.getByRole('button', { name: '删除来源' })).toHaveCount(0)
      await expect(candidate.getByRole('button', { name: '添加来源', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(candidate).toBeHidden()
      await section('站点外观')
      const preview = page.getByRole('switch', { name: '预览当前修改' })
      await settingRow(preview)
      await preview.getByText('预览当前修改').click()
      await expect(preview).toBeChecked()
      await preview.press('Enter')
      await expect(preview).not.toBeChecked()
    }
    if (width === 320) {
      await page.setViewportSize({ width, height: 480 })
      await page.getByRole('button', { name: '编辑 CLIProxyAPI' }).click()
      const disclosure = modal.getByText('迁移已有账户权限', { exact: true })
      await disclosure.click()
      const body = modal.locator('.admin-edit-dialog-body')
      await body.evaluate((e) => {
        e.scrollTop = 0
      })
      const before = await sourceActions()
      assert.ok(await body.evaluate((e) => e.scrollHeight > e.clientHeight))
      await body.evaluate((e) => {
        e.scrollTop = e.scrollHeight
      })
      assert.ok(await body.evaluate((e) => e.scrollTop > 0))
      assert.deepEqual(await sourceActions(), before)
      await shot('long-source-scrolled-320')
      await back.click()
      await page.setViewportSize({ width, height })
    }
    await section('主页模块')

    await edit('codex')
    await measure('codex')
    if (width === 390 || width === 1440) await shot(`codex-${width}`)
    if (width === 390) {
      const slot = modal.getByLabel('Codex 左侧圆环', { exact: true })
      await slot.click()
      const option = page.locator('.var-menu__menu:visible .var-option').filter({
        has: page.getByText('5 小时重置进度', { exact: true }),
      })
      await option.click()
      await expect(option).toBeHidden()
    }

    await edit('devices')
    await expect(modal.getByRole('checkbox')).toHaveCount(5)
    const device = await measure('devices')
    await settingRow(devicesPrivacy)
    if (width === 390) await shot('devices-390')
    if (width === 320 || width === 390) {
      assert.ok(device.bodyScroll[1] > 0 && device.panel.height >= height - 33)
      const body = modal.locator('.admin-edit-dialog-body')
      const item = modal.locator('[data-item-id="device-1"]')
      const checkbox = item.getByRole('checkbox')
      await item.getByRole('button', { name: /^下移设备/ }).click()
      await item.getByRole('button', { name: /^上移设备/ }).click()
      await item.locator('strong').click()
      await expect(checkbox).not.toBeChecked()
      await item.locator('strong').click()
      await expect(checkbox).toBeChecked()
      await modal.getByRole('button', { name: '恢复自动选择' }).click()
      await body.evaluate((el) => (el.scrollTop = el.scrollHeight))
      const afterScroll = await measure('devices-scrolled')
      assert.equal(afterScroll.header.top, device.header.top)
      assert.equal(afterScroll.footer.top, device.footer.top)
      const lastField = await modal
        .getByRole('switch', { name: '访客隐藏设备应用与状态' })
        .boundingBox()
      assert.ok(lastField && lastField.y + lastField.height <= afterScroll.footer.top)
      if (width === 390) await shot('devices-390-scrolled')
    }

    await edit('deepseek')
    const deepseek = await measure('deepseek')
    if (width === 390) await shot('deepseek-permissions-390')
    await expect(dialogHeading).toHaveAccessibleName(longTitle)
    if (width === 320) {
      await titleInput.fill('DeepSeek')
      const normalHeight = (await dialogHeading.boundingBox())!.height
      const headings = [
        '长'.repeat(30),
        '长'.repeat(80),
        'W'.repeat(95),
        'DeepSeek混合标题'.repeat(7),
      ]
      for (const title of headings) {
        await titleInput.fill(title)
        await expect(dialogHeading).toHaveAccessibleName(title)
        await expect(titleInput).toHaveValue(title)
        assert.equal((await dialogHeading.boundingBox())!.height, normalHeight)
        const label = dialogHeading.getByText(title, { exact: true })
        assert.ok(await label.evaluate((el) => el.scrollWidth > el.clientWidth))
      }
      await titleInput.fill(longTitle)
      const headerRight = await back.boundingBox()
      assert.ok(headerRight && headerRight.x + headerRight.width < deepseek.panel.right)
      await shot('deepseek-320-long-title')
      await edit('activity')
      await addDate.click()
      const date = dateDialog.getByLabel('日期', { exact: true })
      await date.focus()
      await expect(date).toBeFocused()
      await date.fill('2026-12-13')
      await page.keyboard.press('Escape')
      await expect(dateDialog).toBeHidden()
      await expect(addDate).toBeFocused()
      await edit('quotes')
      await editor('quotes')
        .getByRole('button', { name: /^编辑标的/ })
        .first()
        .click()
      await expect(
        editQuote.getByRole('textbox', { name: '标的 1 名称', exact: true }),
      ).toHaveValue('行情编辑回归')
      await shot('quote-edit-320')
      await page.keyboard.press('Escape')
      await expect(editQuote).toBeHidden()
      await edit('links')
      await shot('links-list-320')
      await edit('deepseek')
      await expect(titleInput).toHaveValue(longTitle)
    }
  }
  await writeFile(resolve(evidence, 'editor-geometry.json'), JSON.stringify(measurements, null, 2))

  await page.setViewportSize({ width: 1440, height: 900 })
  const more = page.getByRole('button', { name: '更多管理操作', exact: true })
  await back.click()
  await more.click()
  await page.getByRole('menuitem', { name: /^(浅色|暗色)模式$/ }).click()
  await edit('deepseek')
  await expect(editor('deepseek')).toBeVisible()
  await shot('module-alternate-theme')
  await back.click()
  await section('来源接入')
  await source.click()
  await measure('sleepy')
  await sourceActions()
  await shot('sleepy-1440-dark')
  await back.click()
  await section('主页模块')
  await edit('deepseek')
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
  await expect(page.locator('.admin-edit-dialog:visible').getByRole('status')).toContainText(
    '草稿已保留，请读取最新版本',
  )
  await expect(draftTitle).toHaveValue('冲突测试草稿')
  assert.equal((await input()).config.site.siteName, '隔离库并发修改')

  await back.click()
  await more.click()
  await page.getByRole('menuitem', { name: '放弃修改' }).click()
  await page.getByRole('button', { name: '确认放弃' }).click()
  await edit('deepseek')
  await expect(draftTitle).toHaveValue(longTitle)

  await back.click()
  await section('来源接入')
  await source.click()
  const deleteSource = modal.getByRole('button', { name: '删除来源', exact: true })
  const removal = page.getByRole('dialog', { name: '删除 Sleepy？', exact: true })
  await deleteSource.click()
  await expect(removal.getByText(/解除.*来源匹配/)).toBeVisible()
  await removal.getByRole('button', { name: '取消' }).click()
  await expect(deleteSource).toBeFocused()
  await deleteSource.click()
  await removal.getByRole('button', { name: '删除来源', exact: true }).click()
  await expect(source).toHaveCount(0)
  assert.ok((await input()).config.integrations.some((i) => i.id === 'sleepy-fixture'))
  // Reload the known CAS version through the existing discard path before committing removal.
  await more.click()
  await page.getByRole('menuitem', { name: '放弃修改' }).click()
  await page.getByRole('button', { name: '确认放弃' }).click()
  await expect(source).toBeVisible()
  await page.reload()
  await source.click()
  await deleteSource.click()
  await removal.getByRole('button', { name: '删除来源', exact: true }).click()
  await expect(source).toHaveCount(0)
  const deletion = nextPut()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await deletion).status(), 200)
  assert.ok(!(await input()).config.integrations.some((i) => i.id === 'sleepy-fixture'))
  await section('主页模块')
  await edit('activity')
  await choose('日程编辑模式', '自定义周计划')
  await modal.getByText('时间边界与临时显示', { exact: true }).click()
  const override = modal.getByRole('switch', { name: '临时状态覆盖' })
  await settingRow(override)
  await override.getByText('临时显示').click()
  await expect(override).toBeChecked()
  await expect(modal.getByRole('textbox', { name: '临时状态文字' })).toBeVisible()
  await override.press('Space')
  await expect(override).not.toBeChecked()
  await edit('deepseek')

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
