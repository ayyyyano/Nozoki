import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { launch, settle } from './support.mjs'

const origin = process.env.BASE_URL ?? 'http://127.0.0.1:8796'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const credentials = JSON.parse(await readFile(process.env.NOZOKI_UI_CREDENTIAL_FILE, 'utf8'))
const out = '.wrangler/test-results/phase-07-ui/feedback-icons-20261029'
await mkdir(out, { recursive: true })
// Inspect this build's content hashes so the test also works after a fresh build.
const groupFiles = new Set(),
  favoriteChunks = []
for (const file of await readdir('.output/public/_nuxt')) {
  if (!file.endsWith('.js')) continue
  const source = await readFile('.output/public/_nuxt/' + file, 'utf8')
  if ((source.match(/name:[`'"][A-Z][A-Za-z0-9]+[`'"]/g) ?? []).length > 100) groupFiles.add(file)
  if (/name:[`'"]FavoriteRound[`'"]/.test(source)) favoriteChunks.push(file)
}
assert.equal(groupFiles.size, 16)
const browser = await launch(),
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
const page = await context.newPage(),
  report = { checks: [], errors: [], geometry: [], fontRequests: [], iconGroupsRequested: [] }
page.on('pageerror', (e) => report.errors.push(e.message))
page.on('console', (m) => {
  if (
    /hydration.*mismatch|Unhandled error during execution|Failed to resolve component/i.test(
      m.text(),
    )
  )
    report.errors.push(m.text())
})
page.on('request', (r) => {
  if (/\.woff2?|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(r.url()))
    report.fontRequests.push(r.url())
  const file = new URL(r.url()).pathname.split('/').at(-1)
  if (groupFiles.has(file)) report.iconGroupsRequested.push(file)
})
const field = (label) => page.getByLabel(label, { exact: true }).last()
const menu = () => page.getByRole('menu', { name: '更多管理操作', exact: true })
const more = () => page.getByRole('button', { name: '更多管理操作', exact: true })
const drawer = () => page.getByRole('dialog', { name: '选择管理分区', exact: true })
const toast = () => page.locator('.admin-feedback-toast')
async function check(name, fn) {
  await fn()
  report.checks.push(name)
  console.log('PASS ' + name)
}
async function tab(label) {
  const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
  if (await trigger.isVisible()) {
    await trigger.click()
    await drawer().getByRole('button', { name: label, exact: true }).click()
    await drawer().waitFor({ state: 'hidden' })
    await page.waitForTimeout(230)
  } else
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
  await page.waitForTimeout(250)
}
async function noOverflow() {
  const d = await page.evaluate(() => ({
    w: innerWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  assert.ok(d.scroll <= d.client, JSON.stringify(d))
}
try {
  await page.goto(origin + '/login')
  await settle(page)
  await field('邮箱').fill(credentials.email)
  await field('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/admin')
  await field('站点名称').waitFor()
  await check(
    'bottom non-modal Popup, no form shift, automatic success expiry, no font request for default SVG',
    async () => {
      assert.deepEqual(report.fontRequests, [])
      const before = await field('站点名称').boundingBox()
      await field('站点名称').fill('Popup保存测试 ' + Date.now())
      await save()
      const after = await field('站点名称').boundingBox(),
        t = await toast().boundingBox()
      assert.equal(before.y, after.y)
      assert.ok(t.y > 600)
      assert.ok(t.y + t.height <= 900 && t.y + t.height >= 870)
      assert.equal(await page.locator('.admin-shell > .admin-feedback').count(), 0)
      assert.equal(await page.locator('#main-content').evaluate((e) => e.inert), false)
      report.geometry.push({ case: 'save', before, after, toast: t })
      await page.screenshot({ path: out + '/save-popup-desktop.png' })
      await toast().waitFor({ state: 'hidden', timeout: 6000 })
    },
  )
  await check(
    'anchored shadow-free action menu, keyboard/outside close, narrow geometry',
    async () => {
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 844 })
        await page.evaluate(() => scrollTo(0, 0))
        await more().click()
        await menu().waitFor()
        await page.waitForTimeout(250)
        const button = await more().boundingBox(),
          box = await menu().boundingBox()
        assert.ok(Math.abs(box.x + box.width - button.x - button.width) <= 2)
        assert.ok(Math.abs(box.y - button.y - button.height - 6) <= 2)
        assert.equal(await menu().locator('header').count(), 0)
        assert.equal(await menu().getByRole('button', { name: /关闭/ }).count(), 0)
        assert.equal(
          await menu().evaluate((e) => getComputedStyle(e.parentElement).boxShadow),
          'none',
        )
        assert.ok(await menu().evaluate((e) => e.contains(document.activeElement)))
        report.geometry.push({ case: 'menu', width, button, menu: box })
        await page.screenshot({ path: `${out}/menu-${width}.png` })
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Escape')
        await menu().waitFor({ state: 'hidden' })
        await page.waitForFunction(
          () => document.activeElement?.getAttribute('aria-label') === '更多管理操作',
        )
        await more().click()
        await menu().waitFor()
        await page.locator('legend:visible').click()
        await menu().waitFor({ state: 'hidden' })
        await noOverflow()
      }
    },
  )
  await check(
    'drawer has six destinations and no close icon; Escape and backdrop still close',
    async () => {
      const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
      await trigger.click()
      await drawer().waitFor()
      await page.waitForTimeout(250)
      assert.equal(await drawer().getByRole('button').count(), 6)
      assert.equal(await drawer().locator('[data-symbol="close"]').count(), 0)
      await page.screenshot({ path: out + '/drawer-without-close-320.png' })
      await page.keyboard.press('Escape')
      await drawer().waitFor({ state: 'hidden' })
      await trigger.click()
      await drawer().waitFor()
      await page.waitForTimeout(250)
      const x = await drawer().evaluate(
        (e) => (e.getBoundingClientRect().right + document.body.getBoundingClientRect().width) / 2,
      )
      await page.mouse.click(x, 400)
      await drawer().waitFor({ state: 'hidden' })
    },
  )
  await check(
    'full xicons Material input renders and persists beyond the old five icons with no fonts',
    async () => {
      await tab('常用链接')
      await page.locator('.admin-item-toggle:visible').first().click()
      await field('链接 1 图标').fill('SchoolRound')
      const icon = page.locator('.admin-link-icon-input svg[data-symbol="SchoolRound"]')
      await icon.waitFor()
      assert.ok(await icon.locator('path').count())
      assert.equal((await icon.boundingBox()).width, 24)
      assert.deepEqual(report.fontRequests, [])
      await icon.screenshot({ path: out + '/school-xicons.png' })
      await save()
      const config = await (await page.request.get(origin + '/api/admin/config')).json()
      assert.equal(config.links[0].icon, 'SchoolRound')
      await page.reload()
      await settle(page)
      await tab('常用链接')
      await page.locator('.admin-item-toggle:visible').first().click()
      assert.equal(await field('链接 1 图标').inputValue(), 'SchoolRound')
      await page.screenshot({ path: out + '/icon-input-320.png', fullPage: true })
    },
  )
  await check(
    'invalid icon injection never submits; error Popup persists and subsequent legal save succeeds',
    async () => {
      let puts = 0
      const count = (r) => {
        if (r.url().endsWith('/api/admin/config') && r.method() === 'PUT') puts++
      }
      page.on('request', count)
      await field('链接 1 图标').fill('<svg onload=alert(1)>')
      await page.getByText('图标名称不存在，请输入有效名称。', { exact: true }).waitFor()
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      await page.getByText('未保存，请检查以下字段', { exact: true }).waitFor()
      assert.equal(puts, 0)
      await page.waitForTimeout(4300)
      assert.ok(await toast().isVisible())
      await noOverflow()
      await field('链接 1 图标').fill('FavoriteRound')
      await save()
      assert.equal(puts, 1)
      page.off('request', count)
      await page.goto(origin)
      await settle(page)
      await page.locator('.link-grid [data-symbol="FavoriteRound"]').waitFor()
      await page.screenshot({ path: out + '/custom-icon-home-320.png', fullPage: true })
    },
  )
  await check(
    'unavailable icon chunk falls back; logout still revokes server session',
    async () => {
      const failed = await browser.newContext({ viewport: { width: 390, height: 844 } }),
        f = await failed.newPage()
      assert.equal(favoriteChunks.length, 1)
      let aborted = 0
      await f.route('**/_nuxt/*.js', (r) => {
        if (favoriteChunks.includes(new URL(r.request().url()).pathname.split('/').at(-1))) {
          aborted++
          return r.abort()
        }
        return r.continue()
      })
      await f.goto(origin)
      await settle(f)
      const fallback = f.locator('.link-grid a').first().locator('svg path')
      await fallback.waitFor()
      assert.equal(aborted, 1)
      const source = await readFile('node_modules/@vicons/material/es/AutoAwesomeRound.js', 'utf8')
      assert.equal(await fallback.getAttribute('d'), source.match(/d: '([^']+)'/)[1])
      report.failedIconChunk = favoriteChunks[0]
      await failed.close()
      await page.goto(origin + '/admin')
      await field('站点名称').waitFor()
      await more().click()
      await menu().getByRole('menuitem', { name: '注销', exact: true }).click()
      await page.waitForURL('**/login')
      assert.equal((await page.request.get(origin + '/api/admin/config')).status(), 401)
    },
  )
  assert.ok(new Set(report.iconGroupsRequested).size > 0)
  assert.ok(new Set(report.iconGroupsRequested).size < groupFiles.size)
  assert.deepEqual(report.errors, [])
  report.result = 'PASS'
} finally {
  await writeFile(out + '/browser.json', JSON.stringify(report, null, 2))
  await browser.close()
}
