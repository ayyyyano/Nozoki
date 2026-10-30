// Real UI interactions against an explicitly isolated local D1 preview; never production.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { launch, settle } from './support.mjs'
const origin = process.env.BASE_URL ?? 'http://127.0.0.1:8796'
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.ok(process.env.NOZOKI_UI_CREDENTIAL_FILE, 'Supply the isolated preview credential file')
const credentials = JSON.parse(
  await readFile(resolve(process.env.NOZOKI_UI_CREDENTIAL_FILE), 'utf8'),
)
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-07-ui'
await mkdir(evidence, { recursive: true })
const report = { origin, browser: 'Edge', checks: [], layout: [], errors: [] }
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (e) => report.errors.push(e.message))
page.on('console', (m) => {
  if (/hydration.*mismatch|Unhandled error during execution/i.test(m.text()))
    report.errors.push(m.text())
})
async function check(name, fn) {
  await fn()
  report.checks.push(name)
  console.log('PASS ' + name)
}
const field = (label) => page.getByLabel(label, { exact: true }).last()
async function tab(name) {
  const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
  if (await trigger.isVisible()) {
    await trigger.click()
    await page
      .getByRole('dialog', { name: '选择管理分区', exact: true })
      .getByRole('button', { name, exact: true })
      .click()
    await page
      .getByRole('dialog', { name: '选择管理分区', exact: true })
      .waitFor({ state: 'hidden' })
  } else
    await page
      .getByRole('navigation', { name: '管理分区' })
      .getByRole('button', { name, exact: true })
      .click()
  await page.waitForTimeout(180) // Capture settled M3 state layers, not the previous item's fade.
}
async function save() {
  const result = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await result).status(), 200)
  await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
}
async function config() {
  const r = await page.request.get(origin + '/api/admin/config')
  assert.equal(r.status(), 200)
  return r.json()
}
async function choose(label, text) {
  await field(label).click()
  await page.locator('.var-menu__menu:visible .var-option').filter({ hasText: text }).click()
}
async function dimensions(label) {
  const box = await page.evaluate(() => ({
    width: innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    toolbar: document.querySelector('.admin-toolbar')?.getBoundingClientRect().toJSON(),
    nav: document.querySelector('.admin-nav')?.getBoundingClientRect().toJSON(),
    form: document.querySelector('.admin-form')?.getBoundingClientRect().toJSON(),
  }))
  assert.ok(box.scrollWidth <= box.clientWidth, JSON.stringify({ label, ...box }))
  report.layout.push({ label, ...box })
}
try {
  await check(
    'guest SSR/admin API rejected; real login, password visibility, no secret echoed',
    async () => {
      assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 401)
      const r = await page.request.get(origin + '/admin', { maxRedirects: 0 })
      assert.ok([302, 303, 307].includes(r.status()))
      assert.equal(r.headers().location, '/login')
      assert.ok(!(await r.text()).includes('站点名称'))
      await page.goto(origin + '/login')
      await settle(page)
      const emailBox = await field('邮箱')
        .locator('xpath=ancestor::div[contains(@class,"var-field-decorator__controller")]')
        .boundingBox()
      const passwordBox = await field('密码')
        .locator('xpath=ancestor::div[contains(@class,"var-field-decorator__controller")]')
        .boundingBox()
      assert.ok(Math.abs(emailBox.height - passwordBox.height) <= 1, 'Login fields share a height')
      await page.screenshot({ path: evidence + '/after-login-light.png' })
      await field('邮箱').fill(credentials.email)
      await field('密码').fill(credentials.password)
      await page.getByRole('button', { name: '显示密码', exact: true }).click()
      assert.equal(await field('密码').getAttribute('type'), 'text')
      await page.getByRole('button', { name: '隐藏密码', exact: true }).click()
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL('**/admin')
      await field('站点名称').waitFor()
      await settle(page)
      assert.ok(!(await page.content()).includes(credentials.password))
    },
  )
  await check(
    'six widths, shared navigation, both M3 modes, single document scrolling',
    async () => {
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme })
        for (const [width, height] of [
          [1440, 900],
          [1280, 800],
          [1024, 768],
          [768, 1024],
          [390, 844],
          [320, 844],
        ]) {
          await page.setViewportSize({ width, height })
          await tab('站点与外观')
          await dimensions('site-' + scheme + '-' + width)
          assert.equal(
            await page.locator('.admin-form').evaluate((e) => getComputedStyle(e).overflowY),
            'visible',
          )
          await page.screenshot({
            path: `${evidence}/after-site-${scheme}-${width}.png`,
            fullPage: true,
          })
          await tab('常用链接')
          await dimensions('links-' + scheme + '-' + width)
          await page.screenshot({
            path: `${evidence}/after-links-${scheme}-${width}.png`,
            fullPage: true,
          })
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: 'light' })
    },
  )
  await check(
    'real save, count only on focus, discard popup focus trap/return, source preview isolation',
    async () => {
      await tab('站点与外观')
      const storage = await page.evaluate(() => localStorage.getItem('nozoki-appearance-v2'))
      await field('站点名称').fill('UI 专项本地测试')
      assert.equal(await field('站点名称').getAttribute('maxlength'), '100')
      await field('共享主题源色 HEX / RGB').fill('rgb(0, 97, 164)')
      const switchBefore = await page.getByLabel('预览共享外观', { exact: true }).boundingBox()
      await page.getByLabel('预览共享外观', { exact: true }).click()
      await page.waitForFunction(() => document.documentElement.dataset.nozokiSource === '#0061A4')
      const switchAfter = await page.getByLabel('预览共享外观', { exact: true }).boundingBox()
      assert.ok(
        Math.abs(switchBefore.y - switchAfter.y) <= 1,
        'Counter blur must not shift click target',
      )
      await field('共享主题源色 HEX / RGB').fill('#6750A4')
      await page.waitForFunction(() => document.documentElement.dataset.nozokiSource === '#6750A4')
      await save()
      assert.equal((await config()).site.siteName, 'UI 专项本地测试')
      assert.equal(await page.evaluate(() => localStorage.getItem('nozoki-appearance-v2')), storage)
      await field('站点名称').fill('丢弃此草稿')
      const trigger = page.getByRole('button', { name: '放弃修改', exact: true })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: '放弃未保存修改？', exact: true })
      await dialog.waitFor()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      assert.ok(await dialog.evaluate((e) => e.contains(document.activeElement)))
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.activeElement?.textContent?.includes('放弃修改'))
      assert.ok(await trigger.evaluate((e) => document.activeElement === e))
      await trigger.click()
      await page.getByRole('button', { name: '确认放弃', exact: true }).click()
      assert.equal(await field('站点名称').inputValue(), 'UI 专项本地测试')
    },
  )
  await check(
    'links add, full Material name input, collapse retains draft, reorder, save/delete',
    async () => {
      await tab('常用链接')
      const count = (await config()).links.length
      await page.getByRole('button', { name: '添加链接', exact: true }).click()
      await field(`链接 ${count + 1} 名称`).fill('UI 新链接')
      await field(`链接 ${count + 1} URL`).fill('https://example.com/ui-test')
      await field(`链接 ${count + 1} 图标`).fill('SchoolRound')
      await page.locator('.admin-link-icon-input [data-symbol="SchoolRound"]').waitFor()
      const row = page
        .locator('.admin-editor-item')
        .filter({ has: page.locator('.admin-item-copy strong', { hasText: 'UI 新链接' }) })
      await row.locator('.admin-item-toggle').click()
      assert.equal(await field(`链接 ${count + 1} 名称`).isVisible(), false)
      await row.locator('.admin-item-toggle').click()
      assert.equal(await field(`链接 ${count + 1} 名称`).inputValue(), 'UI 新链接')
      await row.getByRole('button', { name: `上移链接 ${count + 1}`, exact: true }).click()
      await save()
      let stored = await config()
      const item = stored.links.find((l) => l.title === 'UI 新链接')
      assert.equal(item.icon, 'SchoolRound')
      assert.equal(item.sortOrder, count - 1)
      await page.screenshot({ path: evidence + '/after-link-expanded-desktop.png', fullPage: true })
      await row.getByRole('button', { name: `删除链接 ${count}`, exact: true }).click()
      await save()
      stored = await config()
      assert.ok(!stored.links.find((l) => l.title === 'UI 新链接'))
    },
  )
  await check(
    'two real browser editing contexts conflict, draft retained, latest explicitly accepted',
    async () => {
      await tab('站点与外观')
      const other = await context.newPage()
      await other.goto(origin + '/admin')
      await other.getByLabel('站点名称', { exact: true }).last().fill('另一个窗口的保存')
      await other.getByRole('button', { name: '保存配置', exact: true }).click()
      await other.getByText('已保存并确认持久化', { exact: true }).waitFor()
      await field('站点名称').fill('保留冲突草稿')
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).waitFor()
      assert.equal(await field('站点名称').inputValue(), '保留冲突草稿')
      await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).click()
      await page.getByRole('button', { name: '保留草稿', exact: true }).click()
      assert.equal(await field('站点名称').inputValue(), '保留冲突草稿')
      await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).click()
      await page.getByRole('button', { name: '放弃草稿并载入最新', exact: true }).click()
      assert.equal(await field('站点名称').inputValue(), '另一个窗口的保存')
      await other.close()
    },
  )
  await check(
    'post-save config read failure, explicit retry recovers without duplicate save',
    async () => {
      await page.route('**/api/admin/config', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"code":"DATABASE_ERROR"}',
          })
        } else await route.continue()
      })
      await field('站点名称').fill('读取恢复测试')
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      await page
        .getByText('配置已保存，但重新读取失败；请读取最新配置确认。凭据输入已清除。', {
          exact: true,
        })
        .waitFor()
      assert.ok(await page.getByRole('button', { name: '保存配置', exact: true }).isDisabled())
      await page.unroute('**/api/admin/config')
      await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).click()
      await page.getByRole('button', { name: '放弃草稿并载入最新', exact: true }).click()
      assert.equal(await field('站点名称').inputValue(), '读取恢复测试')
    },
  )
  await check('real Slider mouse drag in desktop and 320px form', async () => {
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await tab('站点与外观')
      const slider = page.getByRole('slider', { name: '共享水平位置', exact: true })
      const track = page
        .locator('.setting-slider')
        .filter({ has: slider })
        .locator('.var-slider__horizontal-block')
      await track.scrollIntoViewIfNeeded()
      const box = await track.boundingBox()
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 12 })
      await page.mouse.up()
      assert.equal(await slider.getAttribute('aria-valuenow'), '25')
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 12 })
      await page.mouse.up()
      assert.equal(await slider.getAttribute('aria-valuenow'), '75')
    }
    await save()
    assert.equal((await config()).site.background.x, 75)
  })
  await check(
    '320px section dialog keyboard/escape focus return and collapsed link edit',
    async () => {
      const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
      await trigger.scrollIntoViewIfNeeded()
      await trigger.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: '选择管理分区', exact: true })
      await dialog.waitFor()
      for (let i = 0; i < 10; i++) await page.keyboard.press('Tab')
      assert.ok(await dialog.evaluate((e) => e.contains(document.activeElement)))
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '选择管理分区',
      )
      assert.ok(await trigger.evaluate((e) => document.activeElement === e))
      await tab('常用链接')
      await page.locator('.admin-item-toggle:visible').first().click()
      await dimensions('links-expanded-320')
      await page.screenshot({ path: evidence + '/after-link-expanded-320.png', fullPage: true })
    },
  )
  await check('banner default keeps management at viewport top', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await tab('站点与外观')
    const original = (await config()).site.background.layout
    await choose('背景布局', '顶部横幅')
    await page.getByLabel('预览共享外观', { exact: true }).click()
    await page.locator('.background-scene.banner').waitFor({ state: 'attached' })
    await page.evaluate(() => window.scrollTo(0, 0))
    assert.equal(
      await page.locator('.background-scene.banner').evaluate((e) => getComputedStyle(e).position),
      'absolute',
    )
    assert.ok((await page.locator('.admin-toolbar').boundingBox()).y < 40)
    await page.screenshot({
      path: evidence + '/after-management-banner-default.png',
      fullPage: true,
    })
    await choose('背景布局', original === 'page' ? '整页背景' : '顶部横幅')
    await page.getByLabel('预览共享外观', { exact: true }).click()
  })
  await check('logout revokes session; new login screen responsive in both modes', async () => {
    await page.getByRole('button', { name: '注销', exact: true }).click()
    await page.waitForURL('**/login')
    await settle(page)
    assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 401)
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await dimensions('login-' + scheme + '-' + width)
        await page.screenshot({ path: `${evidence}/after-login-${scheme}-${width}.png` })
      }
    }
  })
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(evidence + '/ui-browser.json', JSON.stringify(report, null, 2))
  await browser.close()
}
