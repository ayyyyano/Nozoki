import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { launch, settle } from './support.mjs'

const origin = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const credentials = JSON.parse(await readFile(process.env.NOZOKI_UI_CREDENTIAL_FILE, 'utf8'))
const before = process.env.CAPTURE_BASELINE === '1'
const out = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-07-ui/shell-20261029'
await mkdir(out, { recursive: true })
const browser = await launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
})
const page = await context.newPage()
const report = { checks: [], errors: [], layouts: [] }
page.on('pageerror', (e) => report.errors.push(e.message))
page.on('console', (m) => {
  if (/hydration.*mismatch|Unhandled error during execution/i.test(m.text()))
    report.errors.push(m.text())
})
const field = (label) => page.getByLabel(label, { exact: true }).last()
async function measure(label) {
  const data = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON()
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        clientWidth: document.documentElement.clientWidth,
        layoutWidth: document.body.getBoundingClientRect().width,
      },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      shell: box('.admin-shell'),
      toolbar: box('.admin-toolbar'),
      workspace: box('.admin-workspace'),
      form: box('.admin-form'),
      nav: box('.admin-nav'),
      drawer: box('.admin-section-menu'),
      grid: box('.dashboard-grid'),
      columns:
        document.querySelector('.dashboard-grid') &&
        getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns,
      cards: [...document.querySelectorAll('[data-module]')].map((e) => ({
        id: e.dataset.module,
        ...e.getBoundingClientRect().toJSON(),
      })),
      scrollContainers: [
        ...document.querySelectorAll('.admin-shell,.admin-workspace,.admin-form,.admin-nav'),
      ].map((e) => ({
        className: e.className,
        overflow: getComputedStyle(e).overflowY,
        scrollHeight: e.scrollHeight,
        clientHeight: e.clientHeight,
      })),
    }
  })
  report.layouts.push({ label, ...data })
  if (!before)
    assert.ok(
      data.document.scrollWidth <= data.viewport.clientWidth,
      JSON.stringify({ label, ...data }),
    )
  return data
}
async function screenshot(name) {
  await page.screenshot({
    path: `${out}/${before ? 'before' : 'after'}-${name}.png`,
    fullPage: true,
  })
}
async function login() {
  await page.goto(origin + '/login')
  await settle(page)
  await field('邮箱').fill(credentials.email)
  await field('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/admin')
  await field('站点名称').waitFor()
}
async function tab(label) {
  const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
  if (await trigger.isVisible()) {
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '选择管理分区', exact: true })
    await dialog.getByRole('button', { name: label, exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForTimeout(240)
  } else
    await page
      .getByRole('navigation', { name: '管理分区', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click()
}
try {
  await login()
  for (const width of [1440, 1024, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => scrollTo(0, 0))
    await measure('admin-' + width)
    await screenshot('admin-' + width)
  }
  await page.getByRole('button', { name: '选择管理分区', exact: true }).click()
  await page.waitForTimeout(350)
  await measure('drawer-320')
  await screenshot('drawer-320')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  if (before) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '注销', exact: true }).click()
    await page.waitForURL('**/login')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await settle(page)
      await screenshot('login-' + width)
    }
    await page.goto(origin)
    await settle(page)
    for (const width of [1024, 768, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await measure('dashboard-' + width)
      await screenshot('dashboard-' + width)
    }
  } else {
    async function check(name, fn) {
      await fn()
      report.checks.push(name)
      console.log('PASS ' + name)
    }
    const drawer = page.getByRole('dialog', { name: '选择管理分区', exact: true })
    const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
    async function openDrawer() {
      await trigger.click()
      await drawer.waitFor()
      await page.waitForTimeout(300)
    }
    async function drawerClosed() {
      await drawer.waitFor({ state: 'hidden' })
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '选择管理分区',
      )
      assert.equal(await page.locator('#main-content').evaluate((e) => e.inert), false)
    }
    await check(
      'fullscreen shell, one-row toolbar, container-driven fields at six widths and two themes',
      async () => {
        for (const scheme of ['dark', 'light']) {
          await page.emulateMedia({ colorScheme: scheme })
          for (const width of [1440, 1024, 768, 600, 390, 320]) {
            await page.setViewportSize({ width, height: width === 768 ? 1024 : 900 })
            await page.evaluate(() => scrollTo(0, 0))
            const data = await measure('verified-admin-' + scheme + '-' + width)
            assert.equal(data.shell.x, 0)
            assert.equal(data.shell.y, 0)
            assert.equal(data.shell.width, data.viewport.layoutWidth)
            assert.ok(data.shell.height >= data.viewport.height)
            assert.equal(data.toolbar.height, width <= 900 ? 64 : 72)
            const buttons = await page
              .locator('.admin-toolbar :is(button,a):visible')
              .evaluateAll((items) => items.map((e) => e.getBoundingClientRect().toJSON()))
            for (const b of buttons) {
              assert.ok(
                b.y >= 0 && b.bottom <= data.toolbar.bottom && b.right <= data.viewport.clientWidth,
              )
              assert.ok(Math.abs(b.y + b.height / 2 - data.toolbar.height / 2) < 2)
            }
            assert.equal(await page.locator('.admin-nav').isVisible(), width > 900)
            const fields = await page
              .locator('.admin-fields:visible')
              .first()
              .evaluate((e) => ({
                width:
                  e.parentElement.clientWidth -
                  parseFloat(getComputedStyle(e.parentElement).paddingLeft) -
                  parseFloat(getComputedStyle(e.parentElement).paddingRight),
                columns: getComputedStyle(e).gridTemplateColumns.split(' ').length,
              }))
            assert.equal(fields.columns, fields.width <= 560 ? 1 : 2)
            await screenshot(`admin-${scheme}-${width}`)
          }
        }
      },
    )
    await check(
      'left drawer geometry, Tab trap, scrim/close/Escape, focus return and scroll lock cleanup',
      async () => {
        await page.setViewportSize({ width: 320, height: 844 })
        await openDrawer()
        const b = await drawer.boundingBox()
        assert.equal(b.x, 0)
        assert.equal(b.y, 0)
        assert.equal(b.height, 844)
        assert.ok(b.width <= 320 * 0.85 + 1)
        assert.equal(await page.locator('#main-content').evaluate((e) => e.inert), true)
        const previous = await page.evaluate(() => scrollY)
        await page.mouse.move(300, 400)
        await page.mouse.wheel(0, 600)
        await page.waitForTimeout(100)
        assert.equal(await page.evaluate(() => scrollY), previous)
        for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
        for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab')
        assert.ok(await drawer.evaluate((e) => e.contains(document.activeElement)))
        await page.screenshot({ path: `${out}/after-drawer-viewport-320.png` })
        await page.keyboard.press('Escape')
        await drawerClosed()
        await openDrawer()
        assert.equal(
          await drawer.getByRole('button', { name: '关闭分区菜单', exact: true }).count(),
          0,
        )
        await drawer.getByRole('button', { name: '站点与外观', exact: true }).click()
        await drawerClosed()
        await openDrawer()
        const scrimX = await drawer.evaluate(
          (e) =>
            (e.getBoundingClientRect().right + document.body.getBoundingClientRect().width) / 2,
        )
        await page.mouse.click(scrimX, 400)
        await drawerClosed()
        await page.mouse.wheel(0, 300)
        await page.waitForTimeout(100)
        assert.ok((await page.evaluate(() => scrollY)) > previous)
        await page.evaluate(() => scrollTo(0, 0))
        await screenshot('drawer-closed-320')
        await openDrawer()
        await page.setViewportSize({ width: 1024, height: 768 })
        await drawer.waitFor({ state: 'hidden' })
        assert.equal(await page.locator('#main-content').evaluate((e) => e.inert), false)
      },
    )
    await check(
      'drawer section switch retains draft, icon save uses real CAS, busy state and discard from more menu',
      async () => {
        await page.setViewportSize({ width: 320, height: 844 })
        const draftName = `Shell 草稿保留测试 ${Date.now()}`
        await field('站点名称').fill(draftName)
        await tab('常用链接')
        await tab('站点与外观')
        assert.equal(await field('站点名称').inputValue(), draftName)
        assert.equal(await page.getByRole('status', { name: '未保存修改', exact: true }).count(), 1)
        await page.route('**/api/admin/config', async (route) => {
          if (route.request().method() === 'PUT') await new Promise((r) => setTimeout(r, 350))
          await route.continue()
        })
        const response = page.waitForResponse(
          (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
        )
        await page.getByRole('button', { name: '保存配置', exact: true }).click()
        assert.ok(await page.getByRole('button', { name: '保存中', exact: true }).isDisabled())
        assert.equal((await response).status(), 200)
        await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
        await page.unroute('**/api/admin/config')
        const stored = await (await page.request.get(origin + '/api/admin/config')).json()
        assert.equal(stored.site.siteName, draftName)
        await field('站点名称').fill('此草稿应放弃')
        await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
        await page
          .getByRole('menu', { name: '更多管理操作', exact: true })
          .getByRole('menuitem', { name: '放弃修改', exact: true })
          .click()
        const discard = page.getByRole('dialog', { name: '放弃未保存修改？', exact: true })
        await discard.getByRole('button', { name: '确认放弃', exact: true }).click()
        await discard.waitFor({ state: 'hidden' })
        await page.waitForFunction(
          () => document.activeElement?.getAttribute('aria-label') === '更多管理操作',
        )
        assert.equal(await field('站点名称').inputValue(), draftName)
      },
    )
    await check(
      'all six sections and expanded repeated editors remain within narrow content bounds',
      async () => {
        for (const width of [768, 600, 390, 320]) {
          await page.setViewportSize({ width, height: 844 })
          for (const label of [
            '站点与外观',
            'Dashboard 模块',
            '数据源',
            '日程安排',
            '行情标的',
            '常用链接',
          ]) {
            await tab(label)
            const toggle = page.locator('.admin-item-toggle:visible').first()
            if ((await toggle.count()) && (await toggle.getAttribute('aria-expanded')) !== 'true')
              await toggle.click()
            await measure(`section-${label}-${width}`)
            if (label === '常用链接') await screenshot('links-expanded-' + width)
          }
        }
      },
    )
    await check(
      'desktop three columns and bottom anchor; medium single-column DOM reading order, natural height',
      async () => {
        await page.goto(origin + '/')
        await settle(page)
        for (const width of [1920, 1440, 1100, 1024, 768, 600, 390, 320]) {
          await page.setViewportSize({ width, height: 900 })
          const data = await measure('dashboard-' + width)
          assert.equal(data.columns.split(' ').length, width >= 1440 ? 3 : 1)
          if (width <= 1100)
            for (let i = 1; i < data.cards.length; i++)
              assert.ok(data.cards[i].y >= data.cards[i - 1].bottom - 1)
          if (width >= 1440) {
            for (let i = 0; i < 6; i += 3) {
              const row = data.cards.slice(i, i + 3)
              assert.ok(
                Math.max(...row.map((x) => x.height)) - Math.min(...row.map((x) => x.height)) < 1,
              )
            }
            assert.ok(Math.abs(data.cards.at(-1).bottom - (900 - 24)) <= 2)
          }
          await screenshot('dashboard-' + width)
        }
        assert.equal(await page.locator('.dx-transition').count(), 0)
      },
    )
    await check(
      'guest ACL/SSR, authenticated missing-CSRF rejected; responsive login and real logout',
      async () => {
        assert.equal(
          (
            await page.request.put(origin + '/api/admin/config', {
              headers: { Origin: origin },
              data: {},
            })
          ).status(),
          403,
        )
        const guest = await browser.newContext({ viewport: { width: 768, height: 1024 } })
        const r = await guest.request.get(origin + '/admin', { maxRedirects: 0 })
        assert.equal(r.status(), 303)
        assert.equal((await guest.request.get(origin + '/api/admin/config')).status(), 401)
        const dashboard = await (await guest.request.get(origin + '/api/dashboard')).json()
        assert.equal(dashboard.viewer, 'guest')
        await guest.close()
        await page.goto(origin + '/admin')
        await field('站点名称').waitFor()
        await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
        await page
          .getByRole('menu', { name: '更多管理操作', exact: true })
          .getByRole('menuitem', { name: '注销', exact: true })
          .click()
        await page.waitForURL('**/login')
        assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 401)
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 844 })
          await settle(page)
          await measure('login-' + width)
          assert.equal(await page.locator('.admin-nav').count(), 0)
          await screenshot('login-' + width)
        }
      },
    )
    assert.deepEqual(report.errors, [])
    report.result = 'PASS'
  }
} finally {
  await writeFile(`${out}/${before ? 'before' : 'after'}.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
