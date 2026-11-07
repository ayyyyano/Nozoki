// End-to-end verification of the actual Nuxt production Worker, never a test login route.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { launch, settle } from '../browser/support.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = process.env.NOZOKI_TEST_EVIDENCE ?? '.wrangler/test-results/phase-04'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase04-http', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase04-http/run-'))
const root = resolve('.output/server')
const walk = async (dir) =>
  (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
      ),
    )
  ).flat()
const modules = (await walk(root))
  .filter((p) => p.endsWith('.mjs'))
  .sort((a, b) =>
    a === resolve(root, 'index.mjs')
      ? -1
      : b === resolve(root, 'index.mjs')
        ? 1
        : a.localeCompare(b),
  )
  .map((path) => ({ type: 'ESModule', path }))
const password = 'SYNTHETIC-' + crypto.randomUUID()
const origin = 'http://127.0.0.1:8794'
const env = {
  ADMIN_EMAIL: 'owner@example.invalid',
  ADMIN_PASSWORD: password,
  AUTH_RATE_LIMIT_SECRET: randomToken(),
  INTEGRATION_ENCRYPTION_KEY: randomToken(),
  INTEGRATION_KEY_VERSION: 'v1',
  AUTH_VERSION: '1',
  AUTH_ORIGIN: origin,
  AUTH_ALLOW_LOCAL_HTTP: '1',
}
function options(bindings = env, id = 'admin-http') {
  const opts = convertV4MiniflareOptions({
    modules,
    modulesRoot: root,
    port: 8794,
    host: '127.0.0.1',
    compatibilityDate: '2026-10-19',
    compatibilityFlags: ['nodejs_compat'],
    bindings,
    d1Databases: id ? { DB: id } : {},
    assets: {
      directory: resolve('.output/public'),
      routerConfig: { has_user_worker: true },
      assetConfig: {},
    },
  })
  opts.resourcePersistencePath = persist
  return opts
}
let mf = new Miniflare(options())
const report = {
  persist,
  runtime: wrangler('miniflare/package.json').version,
  checks: [],
  browser: [],
  errors: [],
}
const checks = async (name, fn) => {
  await fn()
  report.checks.push(name)
}
const request = (path, { method = 'GET', body, cookie, headers = {}, target = origin } = {}) =>
  mf.dispatchFetch(target + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
const good = async (headers = {}) => {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { Origin: origin, ...headers },
    body: { email: env.ADMIN_EMAIL, password },
  })
  assert.equal(response.status, 200)
  const set = response.headers.get('set-cookie')
  assert.ok(set)
  assert.ok(set.includes('HttpOnly') && set.includes('SameSite=Strict') && set.includes('Path=/'))
  assert.ok(!set.includes('Domain='))
  return { cookie: set.split(';')[0], set }
}
let browser, db, cookie, csrf
const config = async () => (await request('/api/admin/config', { cookie })).json()
const input = async () => {
  const c = await config()
  return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
}
const put = (body, key = crypto.randomUUID(), headers = {}) =>
  request('/api/admin/config', {
    method: 'PUT',
    cookie,
    body,
    headers: { Origin: origin, 'X-Nozoki-CSRF': csrf, 'Idempotency-Key': key, ...headers },
  })
const count = async (table) => (await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n
try {
  await mf.ready
  db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  await checks('unauthenticated endpoints and spoofed roles refuse config', async () => {
    for (const [method, path] of [
      ['GET', '/api/admin/config'],
      ['PUT', '/api/admin/config'],
    ])
      assert.equal(
        (
          await request(path, {
            method,
            headers: { Origin: origin, 'X-Admin': '1' },
            ...(method === 'PUT' ? { body: {} } : {}),
          })
        ).status,
        401,
      )
    assert.equal(
      (await request('/api/admin/config?role=admin', { headers: { Cookie: 'role=admin' } })).status,
      401,
    )
  })
  cookie = (await good()).cookie
  csrf = (await (await request('/api/auth/csrf', { cookie })).json()).token
  await checks(
    'admin GET is no-store and excludes credential envelopes and auth secrets',
    async () => {
      const response = await request('/api/admin/config', { cookie })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      const text = await response.text()
      for (const marker of ['ciphertext', 'credential_iv', password, env.AUTH_RATE_LIMIT_SECRET])
        assert.ok(!text.includes(marker))
    },
  )
  await checks(
    'CSRF Origin target JSON and input guards do not mutate version or audit',
    async () => {
      const i = await input(),
        n = await count('integration_audit')
      for (const [headers, status] of [
        [{ 'X-Nozoki-CSRF': '' }, 403],
        [{ Origin: 'https://evil.invalid' }, 403],
        [{ Origin: 'null' }, 403],
        [{ Origin: '' }, 403],
        [{ 'Content-Type': 'text/plain' }, 415],
      ])
        assert.equal((await put(i, crypto.randomUUID(), headers)).status, status)
      assert.equal((await put('{')).status, 400)
      assert.equal((await put({ ...i, actorId: 'attacker' })).status, 400)
      assert.equal((await put(i, 'predictable')).status, 400)
      assert.equal((await config()).site.configVersion, i.expectedVersion)
      assert.equal(await count('integration_audit'), n)
    },
  )
  await checks(
    'independent byte budgets reject oversized/chunked config and keep auth small',
    async () => {
      assert.equal((await put(' '.repeat(262145))).status, 413)
      assert.equal(
        (
          await request('/api/auth/login', {
            method: 'POST',
            body: ' '.repeat(4097),
            headers: { Origin: origin },
          })
        ).status,
        413,
      )
      const i = await input()
      i.config.links = Array.from({ length: 90 }, (_, index) => ({
        id: `long-${index}`,
        title: '测试'.repeat(50),
        url: 'https://example.invalid/',
        icon: 'link',
        sortOrder: index,
        visibility: 'public',
        enabled: true,
      }))
      assert.ok(new TextEncoder().encode(JSON.stringify(i)).length > 4096)
      assert.equal((await put(i)).status, 200)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(150000))
          controller.enqueue(new Uint8Array(150000))
          controller.close()
        },
      })
      const response = await fetch(origin + '/api/admin/config', {
        method: 'PUT',
        headers: {
          Origin: origin,
          Cookie: cookie,
          'X-Nozoki-CSRF': csrf,
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: stream,
        duplex: 'half',
      })
      assert.equal(response.status, 413)
    },
  )
  await checks('HTTP concurrent idempotency and CAS each have one committed result', async () => {
    const i = await input(),
      key = crypto.randomUUID(),
      before = await count('integration_audit')
    i.config.site.siteName = 'HTTP atomic'
    const responses = await Promise.all(Array.from({ length: 6 }, () => put(i, key)))
    assert.ok(responses.every((r) => r.status === 200))
    assert.equal((await config()).site.configVersion, i.expectedVersion + 1)
    assert.equal(await count('integration_audit'), before + 1)
    i.config.site.siteName = 'different'
    assert.equal((await put(i, key)).status, 409)
    const a = await input(),
      b = structuredClone(a)
    a.config.site.siteName = 'CAS A'
    b.config.site.siteName = 'CAS B'
    assert.deepEqual((await Promise.all([put(a), put(b)])).map((r) => r.status).sort(), [200, 409])
    const clean = await input(),
      n = await count('integration_audit')
    const noOp = await (await put(clean)).json()
    assert.equal(noOp.changed, false)
    assert.equal(noOp.configVersion, clean.expectedVersion)
    assert.equal(await count('integration_audit'), n)
  })
  await checks(
    'credential keep replace clear plus F01 safe target and keyed receipts',
    async () => {
      let i = await input()
      i.config.links = []
      i.config.modules.find((m) => m.id === 'quotes').sources = {}
      i.config.integrations = [
        {
          id: 'sleepy',
          provider: 'sleepy',
          protocolVersion: 'v1',
          baseUrl: 'https://private-source.invalid/api',
          enabled: true,
          refreshInterval: 300,
          fieldMappings: {},
          capabilities: {},
          credential: { operation: 'replace', value: 'SYNTHETIC_API_CREDENTIAL' },
        },
      ]
      const credentialKey = crypto.randomUUID()
      assert.equal((await put(i, credentialKey)).status, 200)
      assert.equal((await config()).integrations[0].credentialState.configured, true)
      const { INTEGRATION_ENCRYPTION_KEY: _secret, ...withoutEncryption } = env
      await mf.setOptions(options(withoutEncryption))
      db = await mf.getD1Database('DB')
      assert.equal(
        (await put(i, credentialKey)).status,
        200,
        'committed retry needs no encryption again',
      )
      const unavailable = await input()
      unavailable.config.integrations[0].credential = {
        operation: 'replace',
        value: 'SYNTHETIC_REJECTED',
      }
      assert.equal((await put(unavailable)).status, 400)
      await mf.setOptions(options())
      db = await mf.getD1Database('DB')
      const text = JSON.stringify([
        await config(),
        (await db.prepare('SELECT * FROM config_requests').all()).results,
        (await db.prepare('SELECT * FROM integration_audit').all()).results,
      ])
      assert.ok(!text.includes('SYNTHETIC_API_CREDENTIAL'))
      i = await input()
      i.config.integrations[0].baseUrl = 'https://private-source.invalid/other'
      assert.equal((await put(i)).status, 400)
      i.config.integrations[0].credential = { operation: 'clear' }
      assert.equal((await put(i)).status, 200)
      i = await input()
      i.config.integrations = []
      i.config.links = [
        {
          id: 'private',
          title: 'PRIVATE_LINK_MARKER',
          url: 'https://private-link.invalid/',
          icon: 'link',
          sortOrder: 0,
          visibility: 'admin',
          enabled: true,
        },
      ]
      i.config.modules.forEach((m) => {
        m.enabled = true
        m.fields = {}
        m.sources = {}
      })
      // Links are public on UI save; module field ACLs still protect private items.
      i.config.modules.find((m) => m.id === 'links').fields['/items/@private'] = {
        enabled: true,
        visibility: 'admin',
      }
      assert.equal((await put(i)).status, 200)
    },
  )
  await checks(
    'guest API HTML and payload exclude private nested content; admin SSR is private',
    async () => {
      const guest = await request('/api/dashboard'),
        g = await guest.text()
      assert.ok(!g.includes('PRIVATE_LINK_MARKER'))
      const page = await request('/'),
        html = await page.text()
      assert.equal(page.headers.get('cache-control'), 'private, no-store')
      assert.ok(!html.includes('PRIVATE_LINK_MARKER'))
      assert.ok(!html.includes('private-source.invalid'))
      const admin = await request('/', { cookie }),
        a = await admin.text()
      assert.ok(a.includes('PRIVATE_LINK_MARKER'))
      assert.equal(admin.headers.get('cache-control'), 'private, no-store')
    },
  )
  browser = await launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }),
    page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('console', (m) => {
    if (/hydration/i.test(m.text())) report.errors.push(m.text())
  })
  await page.goto(origin + '/login')
  await settle(page)
  await page.getByLabel('邮箱', { exact: true }).last().fill(env.ADMIN_EMAIL)
  await page.getByLabel('密码', { exact: true }).last().fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/admin')
  await page.getByLabel('站点名称', { exact: true }).last().waitFor()
  const saveBrowser = async () => {
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
  }
  const tab = async (name) => {
    await page
      .getByRole('navigation', { name: '管理分区' })
      .getByRole('button', { name, exact: true })
      .click()
  }
  const choose = async (label, text) => {
    await page.getByLabel(label, { exact: true }).last().click()
    await page.locator('.var-menu__menu:visible .var-option').filter({ hasText: text }).click()
  }
  await checks(
    'browser station save preview and personal preferences remain separate',
    async () => {
      const before = await page.evaluate(() => localStorage.getItem('nozoki-appearance-v2'))
      await page.getByLabel('站点名称', { exact: true }).last().fill('浏览器共享站点')
      await page
        .getByLabel('共享主题源色 HEX / RGB', { exact: true })
        .last()
        .fill('rgb(0, 97, 164)')
      await page.getByLabel('预览共享外观', { exact: true }).last().click()
      await page.waitForFunction(() => document.documentElement.dataset.nozokiSource === '#0061A4')
      assert.equal(await page.evaluate(() => localStorage.getItem('nozoki-appearance-v2')), before)
      await saveBrowser()
      assert.equal((await config()).site.siteName, '浏览器共享站点')
      await page.screenshot({ path: `${evidence}/admin-desktop.png`, fullPage: true })
      report.browser.push('site, RGB preview, persistence, preference isolation')
    },
  )
  await checks('browser module reorder visibility ACL editor and schedule', async () => {
    await tab('Dashboard 模块')
    await page.locator('[data-edit-module="deepseek"] .admin-item-toggle').click()
    await page.locator('[data-edit-module="quotes"] .admin-item-toggle').click()
    await page.locator('[data-edit-module="devices"] .admin-item-toggle').click()
    await page.getByLabel('deepseek 标题', { exact: true }).last().fill('私人余额')
    await page.getByRole('button', { name: '上移 links', exact: true }).click()
    await choose('quotes 模块权限', '管理员')
    await choose('quotes 访客行为', '隐藏')
    const device = page.locator('[data-edit-module="devices"]')
    await device.locator('summary').filter({ hasText: '字段权限' }).click()
    await device.getByLabel('添加字段规则', { exact: true }).last().click()
    await page
      .locator('.var-menu__menu:visible .var-option')
      .filter({ hasText: '/devices/*/batteryPercent' })
      .click()
    await device
      .getByLabel('第 2 段项目 ID（留空为全部）', { exact: true })
      .last()
      .fill('future.a/b~c')
    await device.getByRole('button', { name: '添加权限规则', exact: true }).click()
    await tab('日程安排')
    await page.getByLabel('上班时间 HH:mm', { exact: true }).last().fill('09:00')
    await page.locator('summary').filter({ hasText: '手动日程例外' }).click()
    await page.getByLabel('例外日期 YYYY-MM-DD', { exact: true }).last().fill('2026-12-31')
    await page.getByLabel('例外名称', { exact: true }).last().fill('手动休息日')
    await page.getByRole('button', { name: '添加或更新日程例外', exact: true }).click()
    await saveBrowser()
    const c = await config()
    assert.equal(c.modules.find((m) => m.id === 'quotes').visibility, 'admin')
    assert.ok(
      '/devices/@future.a~1b~0c/batteryPercent' in c.modules.find((m) => m.id === 'devices').fields,
    )
    assert.equal(c.site.schedule.start, '09:00')
    report.browser.push('module order, ACL RFC6901, visibility, schedule')
  })
  await checks('browser add/delete quotes links and credential metadata lifecycle', async () => {
    await tab('行情标的')
    await page.getByRole('button', { name: '添加行情标的', exact: true }).click()
    await page.getByLabel('标的 3 代码', { exact: true }).last().fill('MSFT')
    await saveBrowser()
    await page.getByRole('button', { name: '删除标的 3', exact: true }).click()
    await saveBrowser()
    await tab('常用链接')
    await page.getByRole('button', { name: '添加链接', exact: true }).click()
    await page.getByLabel('链接 2 名称', { exact: true }).last().fill('公开新链接')
    await page.getByLabel('链接 2 URL', { exact: true }).last().fill('https://example.invalid/new')
    await saveBrowser()
    assert.ok((await config()).links.every((link) => link.visibility === 'public'))
    await page.getByRole('button', { name: '添加链接', exact: true }).click()
    await page.getByRole('button', { name: '删除链接 3', exact: true }).click()
    await tab('数据源')
    await page.getByRole('button', { name: '添加来源', exact: true }).click()
    await page.getByLabel('来源 ID', { exact: true }).last().fill('browser-source')
    await page
      .getByLabel('服务根 HTTPS 地址', { exact: true })
      .last()
      .fill('https://browser-source.invalid/api')
    await choose('凭据操作', 'replace')
    await page.getByLabel('新凭据', { exact: true }).last().fill('SYNTHETIC_BROWSER_CREDENTIAL')
    await saveBrowser()
    assert.ok((await config()).integrations[0].credentialState.configured)
    assert.equal(await page.getByLabel('新凭据', { exact: true }).last().count(), 0)
    await choose('凭据操作', 'clear')
    await saveBrowser()
    assert.equal((await config()).integrations[0].credentialState.configured, false)
    report.browser.push('quotes, links, integration keep/replace/clear')
  })
  await checks(
    'browser conflict preserves draft, discard and validation error retain changes',
    async () => {
      await tab('站点与外观')
      const other = await context.newPage()
      await other.goto(origin + '/admin')
      await other.getByLabel('站点名称', { exact: true }).last().fill('另一个窗口')
      await other.getByRole('button', { name: '保存配置', exact: true }).click()
      await other.getByText('已保存并确认持久化', { exact: true }).waitFor()
      await page.getByLabel('站点名称', { exact: true }).last().fill('保留我的冲突草稿')
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).waitFor()
      assert.equal(
        await page.getByLabel('站点名称', { exact: true }).last().inputValue(),
        '保留我的冲突草稿',
      )
      await page.getByRole('button', { name: '读取服务器最新配置', exact: true }).click()
      await page.getByRole('button', { name: '保留草稿', exact: true }).click()
      await page.getByRole('button', { name: '放弃修改', exact: true }).focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: '放弃未保存修改？', exact: true })
      await dialog.waitFor()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      assert.ok(await dialog.evaluate((e) => e.contains(document.activeElement)))
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.ok(
        await page
          .getByRole('button', { name: '放弃修改', exact: true })
          .evaluate((e) => e === document.activeElement),
      )
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      await page.getByRole('button', { name: '确认放弃', exact: true }).click()
      assert.notEqual(
        await page.getByLabel('站点名称', { exact: true }).last().inputValue(),
        '保留我的冲突草稿',
      )
      await page.reload()
      await page.getByLabel('站点名称', { exact: true }).last().waitFor()
      await page
        .getByLabel('共享主题源色 HEX / RGB', { exact: true })
        .last()
        .fill('red; background:url(evil)')
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      await page.getByText('未保存，请检查以下字段', { exact: true }).waitFor()
      assert.equal(
        await page.getByLabel('共享主题源色 HEX / RGB', { exact: true }).last().inputValue(),
        'red; background:url(evil)',
      )
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      await page.getByRole('button', { name: '确认放弃', exact: true }).click()
      await other.close()
      report.browser.push('conflict, preserved draft, discard, validation')
    },
  )
  await checks(
    'browser network-loss retry reuses committed request and does not increment twice',
    async () => {
      await page.getByLabel('站点名称', { exact: true }).last().fill('网络重试站点')
      const before = (await config()).site.configVersion
      let first = true
      await page.route('**/api/admin/config', async (route) => {
        if (route.request().method() === 'PUT' && first) {
          first = false
          const response = await route.fetch()
          assert.equal(response.status(), 200)
          await route.abort('failed')
        } else await route.continue()
      })
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      await page
        .getByText('未能确认保存结果。草稿已保留；原样重试会复用请求标识。', { exact: true })
        .waitFor()
      assert.equal((await config()).site.configVersion, before + 1)
      assert.equal(
        await page.getByLabel('站点名称', { exact: true }).last().inputValue(),
        '网络重试站点',
      )
      await saveBrowser()
      assert.equal((await config()).site.configVersion, before + 1)
      await page.unroute('**/api/admin/config')
      report.browser.push('real HTTP committed then lost response; idempotent browser retry')
    },
  )
  await checks(
    'browser explicit overrides win; untouched fields follow changed shared defaults',
    async () => {
      const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } }),
        p = await fresh.newPage()
      await p.goto(origin)
      await settle(p)
      assert.equal(await p.evaluate(() => document.documentElement.dataset.nozokiSource), '#0061A4')
      await p.getByRole('button', { name: '外观偏好', exact: true }).click()
      await p.getByRole('button', { name: '经典紫', exact: true }).click()
      const slider = p.getByRole('slider', { name: '水平位置', exact: true }),
        track = p
          .locator('.setting-slider')
          .filter({ has: slider })
          .locator('.var-slider__horizontal-block'),
        box = await track.boundingBox()
      await p.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
      await p.mouse.down()
      await p.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 8 })
      await p.mouse.up()
      assert.equal(await slider.getAttribute('aria-valuenow'), '25')
      await p.getByRole('button', { name: '关闭外观偏好', exact: true }).click()
      const personal = await p.evaluate(() =>
        JSON.parse(localStorage.getItem('nozoki-appearance-v2')),
      )
      assert.equal(personal.overrides.sourceColor, '#6750A4')
      assert.deepEqual(Object.keys(personal.overrides.background), ['x'])
      const i = await input()
      i.config.site.appearance.sourceColor = '#006A60'
      i.config.site.background.cardBlur = 12
      assert.equal((await put(i)).status, 200)
      await p.reload()
      await settle(p)
      assert.equal(await p.evaluate(() => document.documentElement.dataset.nozokiSource), '#6750A4')
      assert.equal(
        await p.locator('.nozoki-app').evaluate((e) => e.style.getPropertyValue('--card-blur')),
        'blur(12px)',
      )
      await fresh.close()
      report.browser.push('personal source and real Slider override; shared blur refresh')
    },
  )
  await checks(
    'guest frontpage sees shared configuration only, wallpaper DX and mobile remain usable',
    async () => {
      const guestContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          colorScheme: 'dark',
        }),
        guestPage = await guestContext.newPage()
      await guestPage.goto(origin)
      await settle(guestPage)
      assert.equal(await guestPage.title(), '网络重试站点')
      assert.equal(await guestPage.locator('[data-module="quotes"]').count(), 0)
      assert.equal(await guestPage.getByRole('link', { name: '公开新链接' }).count(), 1)
      assert.equal(await guestPage.getByText('PRIVATE_LINK_MARKER').count(), 0)
      assert.equal(
        await guestPage
          .locator('.schedule-times')
          .textContent()
          .then((t) => t.includes('09:00')),
        true,
      )
      await guestPage.getByRole('button', { name: '显示纯壁纸', exact: true }).click()
      assert.equal(await guestPage.locator('#main-content').isVisible(), false)
      await guestPage.getByRole('button', { name: '恢复看板', exact: true }).click()
      assert.equal(await guestPage.locator('.dx-transition').count(), 0)
      assert.ok(await guestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await guestPage.screenshot({ path: `${evidence}/home-mobile.png`, fullPage: true })
      await page.reload()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByLabel('站点名称', { exact: true }).last().waitFor()
      await settle(page)
      await page.screenshot({ path: `${evidence}/admin-mobile.png`, fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.reload()
      await page.getByLabel('站点名称', { exact: true }).last().waitFor()
      await settle(page)
      await page.waitForTimeout(350)
      await page.screenshot({ path: `${evidence}/admin-dark.png`, fullPage: true })
      const noJs = await browser.newContext({ javaScriptEnabled: false }),
        plain = await noJs.newPage()
      await plain.goto(origin)
      assert.ok((await plain.locator('[data-module]').count()) > 0)
      assert.equal(await plain.locator('.dx-transition').count(), 0)
      assert.equal(await plain.getByText('PRIVATE_LINK_MARKER').count(), 0)
      await noJs.close()
      await guestContext.close()
      report.browser.push('guest SSR/frontend config, theme, wallpaper, mobile, no-JS')
    },
  )
  await checks(
    'logout replay cannot read or write; persistent config survives Worker restart',
    async () => {
      const browserCookies = await context.cookies()
      const previousBrowserCookie = browserCookies
        .filter((c) => c.name === 'nozoki_dev_session')
        .map((c) => c.name + '=' + c.value)
        .join('; ')
      await page.getByRole('button', { name: '注销', exact: true }).click()
      await page.waitForURL('**/login')
      await settle(page)
      assert.equal(
        (await request('/api/admin/config', { cookie: previousBrowserCookie })).status,
        401,
      )
      assert.ok(!(await page.content()).includes('PRIVATE_LINK_MARKER'))
      assert.ok(!(await page.content()).includes('browser-source.invalid'))
      const i = await input()
      assert.equal(
        (
          await request('/api/auth/logout', {
            method: 'POST',
            cookie,
            body: {},
            headers: { Origin: origin, 'X-Nozoki-CSRF': csrf },
          })
        ).status,
        200,
      )
      assert.equal((await put(i)).status, 401)
      assert.equal((await request('/api/admin/config', { cookie })).status, 401)
      const version = (await readConfig(db)).site.configVersion
      await mf.dispose()
      mf = new Miniflare(options())
      await mf.ready
      db = await mf.getD1Database('DB')
      assert.equal((await readConfig(db)).site.configVersion, version)
    },
  )
  assert.deepEqual(report.errors, [])
} finally {
  if (browser) await browser.close()
  await mf.dispose()
  await writeFile(`${evidence}/admin-http.json`, JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      checks: report.checks.length,
      browser: report.browser.length,
      errors: report.errors.length,
    }),
  )
}
