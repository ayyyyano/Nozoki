import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { launch, settle } from './support.mjs'

const origin = process.env.BASE_URL ?? 'http://127.0.0.1:8796'
assert.equal(origin, 'http://127.0.0.1:8796', 'This test mutates only the isolated UI database')
const credentials = JSON.parse(await readFile(process.env.NOZOKI_UI_CREDENTIAL_FILE, 'utf8'))
const out = '.wrangler/test-results/phase-07-ui/links-semantics-20261029'
await mkdir(out, { recursive: true })
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const report = { checks: [], errors: [], requests: [] }
page.on('pageerror', (e) => report.errors.push(e.message))
page.on('request', (r) => {
  if (/fonts\.googleapis|fonts\.gstatic|\.woff/.test(r.url())) report.requests.push(r.url())
})
const field = (label) => page.getByLabel(label, { exact: true }).last()
const readConfig = async () => (await context.request.get(origin + '/api/admin/config')).json()
async function check(label, fn) {
  await fn()
  report.checks.push(label)
  console.log('PASS ' + label)
}
async function section(label) {
  await page
    .getByRole('navigation', { name: '管理分区', exact: true })
    .getByRole('button', { name: label, exact: true })
    .click()
}
async function save() {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await response).status(), 200)
  await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
}
try {
  await page.goto(origin + '/login')
  await settle(page)
  await field('邮箱').fill(credentials.email)
  await field('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/admin')
  await field('站点名称').waitFor()
  const initial = await readConfig()
  const config = editableConfig(initial)
  config.links = createDefaultConfig().links
  config.links[0].visibility = 'admin' // Historical records remain private until an admin saves.
  const linksModule = config.modules.find((m) => m.id === 'links')
  linksModule.enabled = true
  linksModule.visibility = 'public'
  linksModule.fields = {}
  const csrf = await (await context.request.get(origin + '/api/auth/csrf')).json()
  const seeded = await context.request.put(origin + '/api/admin/config', {
    headers: {
      Origin: origin,
      'X-Nozoki-CSRF': csrf.token,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { expectedVersion: initial.site.configVersion, config },
  })
  assert.equal(seeded.status(), 200)
  await page.reload()
  await field('站点名称').waitFor()
  await check('removed module and source paragraphs are absent from the DOM', async () => {
    await section('Dashboard 模块')
    assert.equal(
      await page
        .getByText('关闭优先于权限。私有模块可选择隐藏或仅提示登录；数据源 main 引用用于展示。', {
          exact: true,
        })
        .count(),
      0,
    )
    await section('数据源')
    assert.equal(
      await page
        .getByText('保存后可手动只读测试；打开本页不会请求上游。协议匹配不代表全部能力已验证。', {
          exact: true,
        })
        .count(),
      0,
    )
  })
  await check(
    'links have no permission selector; real save publishes legacy items with CAS',
    async () => {
      const guest = await browser.newContext()
      const before = await (await guest.request.get(origin + '/api/dashboard')).json()
      assert.ok(!JSON.stringify(before).includes('https://blog.nekro.top/"'))
      await section('常用链接')
      await page.locator('.admin-item-toggle:visible').first().click()
      assert.equal(await page.getByLabel('链接 1 权限', { exact: true }).count(), 0)
      const version = (await readConfig()).site.configVersion
      await save()
      const saved = await readConfig()
      assert.equal(saved.site.configVersion, version + 1)
      assert.ok(saved.links.every((l) => l.visibility === 'public'))
      await guest.close()
    },
  )
  await check(
    'new links default to public and remain editable without a visibility control',
    async () => {
      await page.getByRole('button', { name: '添加链接', exact: true }).click()
      await field('链接 5 名称').fill('本地公开链接测试')
      await field('链接 5 URL').fill('https://example.com/public-link')
      assert.equal(await page.getByLabel('链接 5 权限', { exact: true }).count(), 0)
      await save()
      assert.equal(
        (await readConfig()).links.find((l) => l.title === '本地公开链接测试').visibility,
        'public',
      )
      await page.getByRole('button', { name: '删除链接 5', exact: true }).click()
      await save()
    },
  )
  await check(
    'four fixed public links and normal Material person render on desktop and phone',
    async () => {
      const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const home = await guest.newPage()
      await home.goto(origin)
      await settle(home)
      for (const link of createDefaultConfig().links) {
        const anchor = home.locator('.link-grid a').filter({ hasText: link.title })
        assert.equal(await anchor.getAttribute('href'), link.url)
      }
      const personSource = await readFile('node_modules/@vicons/material/es/PersonRound.js', 'utf8')
      const expected = personSource.match(/d: '([^']+)'/)[1]
      const about = home.locator('.link-grid a').filter({ hasText: '关于' })
      assert.equal(await about.locator('svg path').first().getAttribute('d'), expected)
      await home.screenshot({ path: out + '/home-links-1440.png', fullPage: true })
      await home.setViewportSize({ width: 320, height: 844 })
      await home.screenshot({ path: out + '/home-links-320.png', fullPage: true })
      assert.ok(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await guest.close()
      await page.setViewportSize({ width: 320, height: 844 })
      await page.locator('.admin-feedback-toast').waitFor({ state: 'hidden', timeout: 6000 })
      await page.screenshot({ path: out + '/admin-links-320.png', fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    },
  )
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.requests, [])
  report.result = 'PASS'
} finally {
  await writeFile(out + '/browser.json', JSON.stringify(report, null, 2))
  await browser.close()
}
