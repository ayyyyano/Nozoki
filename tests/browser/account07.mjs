import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { launch, settle } from './support.mjs'
const origin = process.env.BASE_URL ?? 'http://127.0.0.1:8796'
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.ok(process.env.NOZOKI_UI_CREDENTIAL_FILE, 'Isolated preview credentials are required')
const credentials = JSON.parse(await readFile(process.env.NOZOKI_UI_CREDENTIAL_FILE, 'utf8'))
const out = '.wrangler/test-results/phase-07-account'
await mkdir(out, { recursive: true })
const report = { checks: [], errors: [], layouts: [] }
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (e) => report.errors.push(e.message))
page.on('console', (m) => {
  if (/hydration.*mismatch|Unhandled error during execution/i.test(m.text()))
    report.errors.push(m.text())
})
const loginDialog = () => page.getByRole('dialog', { name: '管理员登录', exact: true })
const accountButton = () => page.locator('.page-actions > .var-button').last()
async function check(name, fn) {
  await fn()
  report.checks.push(name)
  console.log('PASS ' + name)
}
async function openLogin() {
  await page.getByRole('button', { name: '账户登录', exact: true }).click()
  await loginDialog().getByLabel('邮箱', { exact: true }).last().waitFor()
  await page.waitForFunction(() => {
    const popup = document.querySelector('.account-dialog')?.closest('.var-popup__content')
    return (
      popup &&
      !/enter-(active|from|to)/.test(popup.className) &&
      getComputedStyle(popup).opacity === '1'
    )
  })
}
async function close() {
  await page.getByRole('button', { name: '关闭账户对话框', exact: true }).click()
  await page.locator('.account-dialog').waitFor({ state: 'hidden' })
}
try {
  await page.goto(origin + '/')
  await settle(page)
  await check('account icon renders in SSR, is rightmost, dialog has no navigation', async () => {
    const html = await (await page.request.get(origin + '/')).text()
    assert.ok(html.includes('账户登录'))
    assert.equal(await accountButton().getAttribute('aria-label'), '账户登录')
    assert.equal(await accountButton().locator('svg').getAttribute('data-symbol'), 'person')
    await openLogin()
    assert.equal(page.url(), origin + '/')
    assert.ok(await page.locator('#main-content').evaluate((e) => e.inert))
    const dialog = loginDialog()
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+Tab')
    assert.ok(await dialog.evaluate((e) => e.contains(document.activeElement)))
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(
      () =>
        document.activeElement === document.querySelector('.page-actions > .var-button:last-child'),
      undefined,
      { timeout: 2000 },
    )
    assert.ok(await accountButton().evaluate((e) => e === document.activeElement))
    assert.equal(await page.locator('#main-content').evaluate((e) => e.inert), false)
  })
  await check('all private-card login hints open this dialog; close clears password', async () => {
    const hint = page.getByRole('link', { name: '登录后查看', exact: true }).first()
    assert.ok(await hint.count())
    assert.equal(await hint.evaluate((e) => getComputedStyle(e).textDecorationLine), 'none')
    await hint.click()
    await loginDialog().getByLabel('密码', { exact: true }).last().fill('NOT_A_REAL_PASSWORD')
    await close()
    await openLogin()
    assert.equal(await loginDialog().getByLabel('密码', { exact: true }).last().inputValue(), '')
    assert.equal(page.url(), origin + '/')
    await close()
  })
  await check('320/390/1440px, light/dark, no overflow, wallpaper hides account', async () => {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 844 })
        await openLogin()
        const layout = await page.evaluate(() => {
          const e = document.querySelector('.account-dialog'),
            r = e.getBoundingClientRect()
          return {
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            dialog: {
              x: r.x,
              width: r.width,
              right: r.right,
              scrollWidth: e.scrollWidth,
              clientWidth: e.clientWidth,
            },
          }
        })
        assert.ok(layout.scrollWidth <= width)
        assert.ok(
          layout.dialog.x >= 0 &&
            layout.dialog.right <= width &&
            layout.dialog.scrollWidth <= layout.dialog.clientWidth,
        )
        report.layouts.push({ scheme, ...layout })
        await page.screenshot({ path: `${out}/login-${scheme}-${width}.png` })
        await close()
      }
    }
    await page.getByRole('button', { name: '显示纯壁纸', exact: true }).click()
    assert.equal(
      await page.getByRole('button', { name: '账户登录', exact: true }).isVisible(),
      false,
    )
    await page.getByRole('button', { name: '恢复看板', exact: true }).click()
    assert.equal(await page.locator('.dx-transition').count(), 0)
  })
  await check('session-read failure stays safe and explicit retry recovers', async () => {
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"code":"AUTH_UNAVAILABLE"}',
      }),
    )
    await page.getByRole('button', { name: '账户登录', exact: true }).click()
    await page.getByText('暂时无法读取账户状态，请重试', { exact: true }).waitFor()
    assert.equal(await loginDialog().getByLabel('密码', { exact: true }).last().count(), 0)
    await page.unroute('**/api/auth/session')
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await loginDialog().getByLabel('邮箱', { exact: true }).last().waitFor()
    await close()
  })
  await check(
    'wrong credentials stay on home; real successful login refreshes role without admin navigation',
    async () => {
      await openLogin()
      let dialog = loginDialog()
      await dialog.getByLabel('邮箱', { exact: true }).last().fill(credentials.email)
      await dialog.getByLabel('密码', { exact: true }).last().fill('INTENTIONALLY_WRONG_PASSWORD')
      await dialog.getByRole('button', { name: '登录', exact: true }).click()
      await dialog.getByText('邮箱或密码错误', { exact: true }).waitFor()
      assert.equal(page.url(), origin + '/')
      assert.equal(await dialog.getByLabel('密码', { exact: true }).last().inputValue(), '')
      await dialog.getByLabel('密码', { exact: true }).last().fill(credentials.password)
      await page.route('**/api/auth/login', async (route) => {
        await new Promise((r) => setTimeout(r, 400))
        await route.continue()
      })
      await dialog.getByRole('button', { name: '登录', exact: true }).click()
      assert.ok(
        await page.getByRole('button', { name: '关闭账户对话框', exact: true }).isDisabled(),
      )
      await dialog.waitFor({ state: 'hidden' })
      await page.unroute('**/api/auth/login')
      assert.equal(page.url(), origin + '/')
      assert.equal(
        (await (await page.request.get(origin + '/api/dashboard')).json()).viewer,
        'admin',
      )
      assert.equal(await page.getByRole('link', { name: '登录后查看', exact: true }).count(), 0)
      assert.equal(await page.locator('.dx-transition').count(), 0)
      assert.ok(
        !(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).includes(
          credentials.password,
        ),
      )
    },
  )
  await check(
    'refresh restores session; user icon opens admin directly and logout revokes access',
    async () => {
      await page.reload()
      await settle(page)
      const entry = page.getByRole('button', { name: '管理后台', exact: true })
      assert.equal(await entry.getAttribute('aria-haspopup'), null)
      await entry.click()
      await page.waitForURL('**/admin')
      await page.getByRole('heading', { name: '站点管理', exact: true }).waitFor()
      assert.equal(await page.locator('.account-dialog:visible').count(), 0)
      await page.getByRole('button', { name: '注销', exact: true }).click()
      await page.waitForURL('**/login')
      assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 401)
      await page.goto(origin + '/')
      await settle(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openLogin()
      await page.keyboard.press('Escape')
      await loginDialog().waitFor({ state: 'hidden' })
      assert.equal(await page.locator('#main-content').evaluate((e) => e.inert), false)
      assert.equal(await page.locator('.dx-transition').count(), 0)
    },
  )
  await check(
    'direct login route remains compatible with the separate protected admin page',
    async () => {
      assert.equal((await page.request.get(origin + '/admin', { maxRedirects: 0 })).status(), 303)
      await page.goto(origin + '/login')
      await settle(page)
      await page.getByLabel('邮箱', { exact: true }).last().fill(credentials.email)
      await page.getByLabel('密码', { exact: true }).last().fill(credentials.password)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL('**/admin')
      await page.getByRole('heading', { name: '站点管理', exact: true }).waitFor()
      await page.getByRole('button', { name: '注销', exact: true }).click()
      await page.waitForURL('**/login')
    },
  )
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(out + '/browser.json', JSON.stringify(report, null, 2))
  await browser.close()
}
