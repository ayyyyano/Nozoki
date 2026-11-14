import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect } from 'playwright/test'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'

export async function exerciseItemDisplay(
  page,
  { browser, db, snapshots, origin, request, input, save, evidence },
) {
  await mkdir(evidence, { recursive: true })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'log' && /hydrat/i.test(message.text()))
      errors.push(`${new URL(page.url()).pathname}${new URL(page.url()).search} ${message.text()}`)
  })
  const initial = await input()
  const ids = ['devices', 'tailscale', 'services']
  const editor = (id) => page.locator(`[data-module-editor="${id}"]`)
  const edit = async (id) => {
    await page.goto(origin + '/admin?section=modules&module=' + id)
    await expect(editor(id).getByRole('heading', { name: '首页展示' })).toBeVisible()
  }
  const go = async (id) => {
    await page.getByRole('button', { name: '返回模块列表' }).click()
    await page.locator(`[data-edit-module="${id}"] button`).first().click()
    await expect(editor(id)).toBeVisible()
  }
  const idRow = (id) => page.locator(`[data-item-id="${id}"]`)
  const aliasInput = () =>
    page.getByRole('textbox', { name: '显示别名（留空使用来源名称）', exact: true })
  const dialog = page.getByRole('dialog', { name: '编辑展示', exact: true })
  const saveButton = page.getByRole('button', { name: '保存配置', exact: true })
  const editRow = (id) => idRow(id).getByRole('button', { name: /^编辑 / })
  const changeAlias = async (id, name, icon?) => {
    await editRow(id).click()
    await aliasInput().fill(name)
    if (icon) {
      await dialog.getByLabel('设备图标', { exact: true }).click()
      await page
        .locator('.var-menu__menu:visible .var-option')
        .filter({ has: page.getByText(icon, { exact: true }) })
        .click()
    }
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  const shot = async (name) => {
    if (name.startsWith('admin-')) await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: resolve(evidence, name + '.png'),
      fullPage: true,
      animations: 'disabled',
    })
  }
  const dashboardItem = (id) => page.locator(`[data-module="${id}"]`)
  const selection = (items) => items.evaluateAll((rows) => rows.map((row) => row.dataset.itemId))
  const settings = (value, id) => value.config.modules.find((item) => item.id === id)
  const guest = (path) => request(path, 'GET', undefined, { Cookie: '' })
  const snapshotRows = () =>
    db
      .prepare('SELECT module_id,snapshot_json FROM integration_snapshot_views ORDER BY module_id')
      .all()
  const snapshotBefore = (await snapshotRows()).results

  await edit('devices')
  await expect(editor('devices').getByRole('checkbox')).toHaveCount(5)
  const lastDevice = snapshots.devices.data.devices.at(-1).id
  await expect(idRow(lastDevice).getByRole('checkbox')).toBeDisabled()
  await idRow('device-3').getByRole('checkbox').uncheck()
  await idRow(lastDevice).getByRole('checkbox').check()
  const down = idRow('device-0').getByRole('button', { name: /^下移设备 / })
  await down.focus()
  await page.keyboard.press('Enter')
  assert.deepEqual(await selection(editor('devices').locator('[data-selected="true"]')), [
    'device-1',
    'device-0',
    'device-2',
    lastDevice,
  ])
  await changeAlias('device-0', '零电量手机', '手机')
  await changeAlias('device-1', '桌面设备', '显示器')
  await changeAlias('device-1', '', '自动图标')
  await editRow(lastDevice).click()
  await expect(dialog.getByRole('button', { name: '关闭对话框' })).toBeFocused()
  await aliasInput().fill('  ')
  await expect(dialog.getByRole('button', { name: '应用' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(editRow(lastDevice)).toBeFocused()
  await changeAlias(lastDevice, '用于验证窄屏省略显示和完整详情的长设备别名'.repeat(3))
  await shot('admin-devices-1440')
  await go('tailscale')
  await expect(editor('tailscale').getByRole('checkbox')).toHaveCount(10)
  await idRow('tail-node-7').getByRole('checkbox').uncheck()
  await idRow('tail-node-8').getByRole('checkbox').check()
  await idRow('tail-node-1')
    .getByRole('button', { name: /^上移节点 / })
    .click()
  await changeAlias('tail-node-0', '工作节点')
  await go('services')
  await expect(editor('services').locator('[data-selected="true"]')).toHaveCount(3)
  assert.deepEqual(await selection(editor('services').locator('[data-selected="true"]')), [
    'flare-fixture/service-2',
    'flare-fixture/service-0',
    'flare-fixture/service-1',
  ])
  await changeAlias('flare-fixture/service-2', '异常服务别名')
  await changeAlias('flare-fixture/service-0', '<b>个人主页</b>')
  await go('activity')
  await go('devices')
  await expect(idRow('device-0')).toContainText('零电量手机')
  await expect(idRow('device-1')).toContainText('SYNTHETIC DEVICE 1')
  assert.deepEqual(await input(), initial)

  const keys = []
  await page.route('**/api/admin/config', (route) => {
    if (route.request().method() === 'PUT') {
      keys.push(route.request().headers()['idempotency-key'])
      if (keys.length === 1) return route.abort('failed')
    }
    return route.continue()
  })
  await saveButton.click()
  await expect(page.getByText(/未能确认保存结果/)).toBeVisible()
  await expect(idRow('device-0')).toContainText('零电量手机')
  const put = () =>
    page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
    )
  const firstSave = put()
  await saveButton.click()
  const savedResponse = await firstSave
  assert.equal(savedResponse.status(), 200)
  assert.equal((await savedResponse.json()).collection, 'not_needed')
  await expect(page.getByText(/已保存并确认持久化|配置已保存/)).toBeVisible()
  assert.ok(keys[0])
  assert.equal(keys[0], keys[1])
  const saved = await input()
  assert.deepEqual(
    settings(saved, 'services').homeServices,
    settings(initial, 'services').homeServices,
  )
  assert.equal(
    settings(saved, 'devices').presentation.deviceOverrides.find((r) => r.itemId === 'device-0')
      .icon,
    'SmartphoneRound',
  )
  assert.ok(
    !settings(saved, 'devices').presentation.deviceOverrides.some((r) => r.itemId === 'device-1'),
  )
  assert.equal(settings(saved, 'tailscale').presentation.tailnetAliases[0].alias, '工作节点')
  assert.equal(settings(saved, 'services').presentation.serviceAliases.length, 2)
  assert.deepEqual((await snapshotRows()).results, snapshotBefore)

  await page.reload()
  await expect(idRow('device-0')).toContainText('零电量手机')
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height })
    for (const id of ids) {
      await go(id)
      await expect(editor(id).getByRole('checkbox').first()).toBeVisible()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (width === 390 || (width === 320 && id === 'services')) await shot(`admin-${id}-${width}`)
    }
    await editRow('flare-fixture/service-0').click()
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }
  await changeAlias('flare-fixture/service-0', '')
  const concurrent = await input()
  settings(concurrent, 'services').title = '服务状态（并发测试）'
  assert.equal((await save(concurrent)).status, 200)
  const conflict = put()
  await saveButton.click()
  assert.equal((await conflict).status(), 409)
  await expect(idRow('flare-fixture/service-0')).not.toContainText('<b>个人主页</b>')
  await page.getByRole('button', { name: '更多管理操作' }).click()
  await page.getByRole('menuitem', { name: '放弃修改' }).click()
  await page.getByRole('button', { name: '确认放弃' }).click()
  await expect(idRow('flare-fixture/service-0')).toContainText('<b>个人主页</b>')

  const policy = await input()
  settings(policy, 'devices').fields = {
    '/devices/@device-2/name': { enabled: true, visibility: 'admin' },
    '/devices/@device-2/foregroundApp': { enabled: true, visibility: 'admin' },
  }
  settings(policy, 'devices').presentation.deviceOverrides.push({
    itemId: 'device-2',
    sourceId: 'sleepy-fixture',
    alias: 'PRIVATE DEVICE ALIAS',
  })
  Object.assign(settings(policy, 'tailscale').presentation, {
    tailnetName: 'masked',
    tailnetIp: 'hidden',
  })
  settings(policy, 'tailscale').fields['/devices/@tail-node-1'] = {
    enabled: true,
    visibility: 'admin',
  }
  settings(policy, 'services').fields['/monitors/@flare-fixture~1service-2'] = {
    enabled: true,
    visibility: 'admin',
  }
  const key = crypto.randomUUID()
  assert.equal((await save(policy, key)).status, 200)
  assert.equal((await (await save(policy, key)).json()).replayed, true)
  const sensitive = [
    'PRIVATE DEVICE ALIAS',
    'PRIVATE FOREGROUND',
    'SYNTHETIC DEVICE 2',
    'tail-node-1"',
    '工作节点',
    '100.64.',
    'fd7a:115c',
    '异常服务别名',
    'flare-fixture/service-2',
  ]
  const checkMasked = (text) =>
    sensitive.forEach((marker) => assert.ok(!text.includes(marker), marker))
  checkMasked(await (await guest('/api/dashboard')).text())
  checkMasked(await (await guest('/')).text())
  assert.equal((await guest('/api/admin/display-items/devices')).status, 401)
  assert.equal((await guest('/api/admin/config')).status, 401)
  const admin = await (await request('/api/dashboard')).json()
  assert.deepEqual(admin.modules.find((m) => m.id === 'devices').snapshot.homeItems, [
    'device-1',
    'device-0',
    'device-2',
    lastDevice,
  ])
  assert.match(JSON.stringify(admin), /PRIVATE FOREGROUND/)
  assert.match(JSON.stringify(admin), /工作节点/)
  assert.match(JSON.stringify(admin), /异常服务别名/)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin)
  await expect(dashboardItem('devices').locator('.device-row')).toHaveCount(4)
  await expect(dashboardItem('tailscale').locator('.tailnet-device')).toHaveCount(8)
  await expect(dashboardItem('devices').locator('[data-device-id="device-0"]')).toContainText('0%')
  await expect(
    dashboardItem('devices').locator('[data-device-id="device-0"] [data-symbol="SmartphoneRound"]'),
  ).toHaveCount(1)
  await expect(
    dashboardItem('devices').locator('[data-device-id="device-0"] .device-battery-dots i'),
  ).toHaveCount(4)
  await expect(
    dashboardItem('devices').locator('[data-device-id="device-1"] .device-battery-dots'),
  ).toHaveCount(0)
  await shot('dashboard-admin-1440')
  await dashboardItem('devices').getByRole('button', { name: /详情/ }).click()
  await expect(page.locator('.module-detail-panel .device-row')).toHaveCount(5)
  await expect(page.locator('.module-detail-panel')).toContainText('来源名称 · SYNTHETIC DEVICE 0')
  await shot('dashboard-device-detail')
  await page.keyboard.press('Escape')
  await expect(page.locator('.module-detail-panel:visible')).toHaveCount(0)
  await dashboardItem('services').getByRole('button', { name: /详情/ }).click()
  await expect(page.locator('.module-detail-panel .monitor-row')).toHaveCount(8)
  await expect(
    page.locator('.module-detail-panel').filter({ has: page.locator('.monitor-row') }),
  ).toContainText('service-2')
  await shot('dashboard-services-detail')
  await page.keyboard.press('Escape')
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const visitor = await context.newPage()
  await visitor.goto(origin)
  await expect(visitor.locator('[data-module="services"] .monitor-row')).toHaveCount(2)
  await expect(visitor.locator('[data-module="services"] .monitor-row h3').first()).toHaveText(
    '<b>个人主页</b>',
  )
  await expect(visitor.locator('[data-module="services"] .monitor-row b')).toHaveCount(0)
  for (const id of ids) {
    const title = await visitor.locator(`#heading-${id}`).innerText()
    const panel = visitor.locator('.module-detail-panel').filter({
      has: visitor.getByRole('heading', { name: title, exact: true }),
    })
    await visitor.locator(`[data-module="${id}"]`).getByRole('button', { name: /详情/ }).click()
    await expect(panel).toBeVisible()
    checkMasked(await panel.innerHTML())
    checkMasked(await visitor.content())
    if (id === 'tailscale')
      await visitor.screenshot({
        path: resolve(evidence, 'dashboard-guest-tailnet-detail.png'),
        animations: 'disabled',
      })
    await visitor.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  }
  await context.close()

  for (const [width, height] of [
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height })
    await expect(dashboardItem('devices').locator('.device-row')).toHaveCount(4)
    await expect(dashboardItem('tailscale').locator('.tailnet-device')).toHaveCount(8)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const cards = await page
      .locator('[data-module="devices"], [data-module="tailscale"], [data-module="services"]')
      .evaluateAll((elements) =>
        elements.map((card) => ({
          height: card.getBoundingClientRect().height,
          fits: card.scrollHeight <= card.clientHeight + 1,
          width: card.closest('.dashboard-grid')!.getBoundingClientRect().width,
        })),
      )
    assert.ok(
      cards.every((card) => card.fits),
      JSON.stringify({ width, cards }),
    )
    if (cards[0].width >= 700) assert.ok(cards.every((card) => card.height === 240))
    if (width === 390) await shot('dashboard-admin-390')
  }

  const changed = structuredClone(snapshots.devices)
  changed.data.devices = changed.data.devices.filter((device) => device.id !== lastDevice)
  changed.data.devices.find((device) => device.id === 'device-0').name = 'RENAMED DEVICE'
  changed.expiresAt = '2020-01-01T00:00:00.000Z'
  await db.prepare("UPDATE integrations SET enabled=0 WHERE id='flare-fixture'").run()
  await edit('services')
  await expect(idRow('flare-fixture/service-2')).toContainText('当前未发现')
  await expect(idRow('flare-fixture/service-2')).toContainText('异常服务别名')
  await upsertSnapshot(db, {
    sourceId: changed.sourceId,
    moduleId: 'devices',
    subject: 'default',
    snapshot: changed,
    updatedAt: new Date().toISOString(),
  })
  const movedNode = structuredClone(snapshots.tailscale)
  movedNode.data.devices = movedNode.data.devices.filter((node) => node.id !== 'tail-node-8')
  const renamed = movedNode.data.devices.find((node) => node.id === 'tail-node-0')
  renamed.name = 'RENAMED NODE'
  renamed.addresses = ['100.64.99.1', 'fd7a:115c:a1e0::99']
  await upsertSnapshot(db, {
    sourceId: movedNode.sourceId,
    moduleId: 'tailscale',
    subject: 'default',
    snapshot: movedNode,
    updatedAt: new Date().toISOString(),
  })
  await edit('devices')
  await expect(idRow(lastDevice)).toContainText('当前未发现')
  await expect(idRow('device-0')).toContainText('零电量手机')
  const afterChange = await (await request('/api/dashboard')).json()
  assert.equal(afterChange.modules.find((m) => m.id === 'devices').snapshot.homeItems.length, 3)
  const tailnet = afterChange.modules.find((m) => m.id === 'tailscale').snapshot
  assert.deepEqual(tailnet.homeItems.slice(0, 2), ['tail-node-1', 'tail-node-0'])
  assert.equal(tailnet.homeItems.length, 7)
  assert.equal(tailnet.data.devices.find((node) => node.id === 'tail-node-0').name, '工作节点')
  checkMasked(await (await guest('/api/dashboard')).text())
  assert.equal(settings(await input(), 'devices').presentation.deviceHome.length, 4)

  const reset = await input()
  settings(reset, 'devices').presentation.deviceHome = []
  settings(reset, 'services').presentation.serviceAliases = []
  assert.equal((await save(reset)).status, 200)
  const reread = await input()
  assert.deepEqual(settings(reread, 'devices').presentation.deviceHome, [])
  assert.deepEqual(
    settings(reread, 'services').homeServices,
    settings(initial, 'services').homeServices,
  )
  assert.deepEqual(settings(reread, 'services').presentation.serviceAliases, [])
  await page.reload()
  await expect(editor('devices')).toContainText('0 / 4')
  await page.getByRole('button', { name: '恢复自动选择' }).click()
  await expect(editor('devices')).toContainText('自动选择')
  await page.getByRole('button', { name: '清空首页选择' }).click()
  await idRow('device-0').getByRole('checkbox').check()
  await page.context().clearCookies()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForURL('**/login')
  assert.deepEqual(settings(await input(), 'devices').presentation.deviceHome, [])
  assert.deepEqual(errors, [])
}
