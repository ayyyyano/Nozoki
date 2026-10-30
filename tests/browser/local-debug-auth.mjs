import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { launch, settle } from './support.mjs'

const origin = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const credentials = JSON.parse(await readFile(process.env.NOZOKI_UI_CREDENTIAL_FILE, 'utf8'))
const out = '.wrangler/test-results/local-debug-auth'
await mkdir(out, { recursive: true })
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const report = { origin, checks: [], errors: [] }
page.on('pageerror', (error) => report.errors.push(error.message))
try {
  assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 401)
  report.checks.push('guest admin API denied')
  await page.goto(origin)
  await settle(page)
  await page.getByRole('button', { name: '账户登录', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '管理员登录', exact: true })
  await dialog.getByLabel('邮箱', { exact: true }).last().fill(credentials.email)
  await dialog.getByLabel('密码', { exact: true }).last().fill(credentials.password)
  await dialog.getByRole('button', { name: '登录', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(page.url(), origin + '/')
  const cookie = (await context.cookies()).find((c) => c.name === 'nozoki_dev_session')
  assert.ok(cookie?.httpOnly && cookie.sameSite === 'Strict')
  assert.equal(
    (await (await page.request.get(origin + '/api/auth/session')).json()).viewer,
    'admin',
  )
  report.checks.push('real login, HTTP-only session and homepage modal')
  assert.equal(
    (
      await page.request.put(origin + '/api/admin/config', {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
    403,
  )
  report.checks.push('authenticated mutation without CSRF denied')
  await page.reload()
  await settle(page)
  await page.getByRole('button', { name: '管理后台', exact: true }).click()
  await page.waitForURL('**/admin')
  await page.getByRole('heading', { name: '站点管理', exact: true }).waitFor()
  assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 200)
  await page.screenshot({ path: `${out}/admin-${new URL(origin).port}.png` })
  report.checks.push('refresh restores real D1 session; account opens admin directly')
  assert.ok(
    !(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).includes(
      credentials.password,
    ),
  )
  await page.getByRole('button', { name: '注销', exact: true }).click()
  await page.waitForURL('**/login')
  assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 401)
  report.checks.push('server logout revokes session; no password in browser storage')
  assert.deepEqual(report.errors, [])
  report.result = 'PASS'
} finally {
  await writeFile(`${out}/browser-${new URL(origin).port}.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report))
