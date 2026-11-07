// End-to-end verification of the actual Nuxt production Worker, never a test login route.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { launch, settle } from '../browser/support.ts'
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
const evidence = process.env.NOZOKI_TEST_EVIDENCE ?? '.wrangler/test-results/phase-03'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase03-http', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase03-http/run-'))
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
const origin = 'http://127.0.0.1:8793'
const env = {
  ADMIN_EMAIL: 'owner@example.invalid',
  ADMIN_PASSWORD: password,
  AUTH_RATE_LIMIT_SECRET: randomToken(),
  AUTH_VERSION: '1',
  AUTH_ORIGIN: origin,
  AUTH_ALLOW_LOCAL_HTTP: '1',
}
function options(bindings = env, id = 'auth-http') {
  const opts = convertV4MiniflareOptions({
    modules,
    modulesRoot: root,
    port: 8793,
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
const mf = new Miniflare(options())
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
let browser
try {
  const url = await mf.ready
  assert.equal(url.origin, origin)
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  const c = await readConfig(db)
  const write = {
    ...c,
    integrations: [
      {
        id: 'auth-private',
        provider: 'sleepy',
        protocolVersion: 'fixture',
        baseUrl: 'https://private-source.invalid/api/',
        enabled: true,
        refreshInterval: 300,
        fieldMappings: {},
        capabilities: {},
        credential: { operation: 'keep' },
      },
    ],
  }
  const deviceModule = write.modules.find((m) => m.id === 'devices')
  deviceModule.visibility = 'public'
  deviceModule.sources.main = { sourceId: 'auth-private', subject: 'shared' }
  deviceModule.fields = { '/devices/@private.device': { enabled: true, visibility: 'admin' } }
  assert.equal(
    (
      await saveConfig(
        db,
        { expectedVersion: c.site.configVersion, config: write },
        { actor: { kind: 'system', id: 'auth-http-test' } },
      )
    ).success,
    true,
  )
  const device = (id) => ({
    id,
    name: id,
    using: true,
    stateText: id === 'private.device' ? 'PRIVATE_STATE' : 'PUBLIC_STATE',
    online: true,
    batteryPercent: 0,
    charging: false,
    observedAt: null,
    heartbeatAt: null,
    capabilities: {},
  })
  await upsertSnapshot(db, {
    sourceId: 'auth-private',
    subject: 'shared',
    moduleId: 'devices',
    snapshot: snapshot(
      'ok',
      { devices: [device('private.device'), device('PUBLIC_DEVICE')] },
      'auth-private',
    ),
    updatedAt: new Date().toISOString(),
  })
  const count = async (table) => (await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n
  await checks(
    'guest and forged role requests stay guest without session/rate writes',
    async () => {
      for (let i = 0; i < 8; i++) {
        const r = await request('/api/dashboard?role=admin&fixture=edge', {
          headers: { 'x-admin': 'true', Cookie: 'role=admin; nozoki_dev_session=forged' },
        })
        assert.equal(r.status, 200)
        const v = await r.json()
        assert.equal(v.viewer, 'guest')
        assert.ok(!JSON.stringify(v).includes('private.device'))
      }
      assert.equal(await count('sessions'), 0)
      assert.equal(await count('login_limits'), 0)
      assert.equal((await request('/api/auth/csrf')).status, 401)
      assert.equal((await request('/admin')).status, 303)
      const preflight = await request('/api/auth/login', {
        method: 'OPTIONS',
        headers: { Origin: 'https://attacker.invalid', 'Access-Control-Request-Method': 'POST' },
      })
      assert.notEqual(preflight.headers.get('access-control-allow-credentials'), 'true')
    },
  )
  await checks(
    'login rejects absent/null/cross-site origins, form bodies and oversized/invalid UTF8 JSON',
    async () => {
      for (const headers of [
        {},
        { Origin: 'null' },
        { Origin: 'https://attacker.invalid' },
        { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
      ])
        assert.equal(
          (
            await request('/api/auth/login', {
              method: 'POST',
              headers,
              body: { email: env.ADMIN_EMAIL, password },
            })
          ).status,
          403,
        )
      assert.equal(
        (
          await request('/api/auth/login', {
            method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'email=x&password=x',
          })
        ).status,
        415,
      )
      assert.equal(
        (
          await request('/api/auth/login', {
            method: 'POST',
            headers: { Origin: origin },
            body: 'x'.repeat(6000),
          })
        ).status,
        413,
      )
      assert.equal(
        (
          await request('/api/auth/login', {
            method: 'POST',
            headers: { Origin: origin },
            body: '{bad json',
          })
        ).status,
        400,
      )
      const bad = await mf.dispatchFetch(origin + '/api/auth/login', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: new Uint8Array([0xff, 0xfe]),
      })
      assert.equal(bad.status, 400)
      assert.equal(await count('sessions'), 0)
    },
  )
  let first, second
  await checks(
    'real login sets an opaque HttpOnly cookie, restores state and returns safe admin DTO',
    async () => {
      first = await good()
      assert.ok(first.cookie.startsWith('nozoki_dev_session='))
      assert.ok(!/; Secure/i.test(first.set))
      const session = await request('/api/auth/session', { cookie: first.cookie })
      assert.equal(session.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await session.json(), { viewer: 'admin', email: env.ADMIN_EMAIL })
      const r = await request('/api/dashboard', { cookie: first.cookie })
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('cache-control'), 'private, no-store')
      const body = await r.json()
      assert.equal(body.viewer, 'admin')
      assert.ok(JSON.stringify(body).includes('private.device'))
      for (const marker of [
        'auth-private',
        'baseUrl',
        'ciphertext',
        'credential',
        'auth_fingerprint',
        password,
        first.cookie.split('=')[1],
      ])
        assert.ok(!JSON.stringify(body).includes(marker))
      const adminPage = await request('/admin', { cookie: first.cookie })
      assert.equal(adminPage.status, 200)
      assert.equal(adminPage.headers.get('cache-control'), 'private, no-store')
      const html = await adminPage.text()
      for (const marker of [
        password,
        env.AUTH_RATE_LIMIT_SECRET,
        first.cookie.split('=')[1],
        'auth_fingerprint',
      ])
        assert.ok(!html.includes(marker))
      // Since phase 04 an authenticated SSR payload can contain the safe admin
      // Dashboard DTO. It must remain private and never reach a guest response.
      assert.equal(adminPage.headers.get('vary'), 'Cookie')
      const guestPage = await request('/')
      assert.ok(!(await guestPage.text()).includes('PRIVATE_STATE'))
      const adminConfig = await request('/api/admin/config', { cookie: first.cookie })
      assert.equal(adminConfig.status, 200)
      const configText = await adminConfig.text()
      for (const marker of [password, env.AUTH_RATE_LIMIT_SECRET, 'ciphertext', 'credential_iv'])
        assert.ok(!configText.includes(marker))
    },
  )
  await checks(
    'logout requires same origin and valid session-bound CSRF; replay remains revoked',
    async () => {
      const csrf = await (await request('/api/auth/csrf', { cookie: first.cookie })).json()
      assert.equal(
        (await request('/api/auth/logout', { method: 'POST', cookie: first.cookie, body: {} }))
          .status,
        403,
      )
      for (const headers of [
        { Origin: origin },
        { Origin: origin, 'X-Nozoki-CSRF': '0'.repeat(64) },
        { Origin: 'null', 'X-Nozoki-CSRF': csrf.token },
      ])
        assert.equal(
          (
            await request('/api/auth/logout', {
              method: 'POST',
              cookie: first.cookie,
              headers,
              body: {},
            })
          ).status,
          403,
        )
      assert.equal(
        (await (await request('/api/auth/session', { cookie: first.cookie })).json()).viewer,
        'admin',
      )
      second = await good()
      assert.equal(
        (
          await request('/api/auth/logout', {
            method: 'POST',
            cookie: second.cookie,
            headers: { Origin: origin, 'X-Nozoki-CSRF': csrf.token },
            body: {},
          })
        ).status,
        403,
      )
      const r = await request('/api/auth/logout', {
        method: 'POST',
        cookie: first.cookie,
        headers: { Origin: origin, 'X-Nozoki-CSRF': csrf.token },
        body: {},
      })
      assert.equal(r.status, 200)
      assert.ok(r.headers.get('set-cookie').includes('Max-Age=0'))
      assert.equal(
        (await (await request('/api/auth/session', { cookie: first.cookie })).json()).viewer,
        'guest',
      )
      assert.equal(
        (await (await request('/api/dashboard', { cookie: first.cookie })).json()).viewer,
        'guest',
      )
      assert.equal(
        (await db.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NOT NULL').first())
          .n,
        1,
      )
    },
  )
  await checks(
    'forged proxy headers cannot change local cookie security/origin policy or bypass persistent limits',
    async () => {
      await db.prepare('DELETE FROM login_limits').run()
      for (let i = 0; i < 8; i++) {
        const r = await request('/api/auth/login', {
          method: 'POST',
          headers: {
            Origin: origin,
            'X-Forwarded-For': `10.0.0.${i}`,
            'CF-Connecting-IP': `9.9.9.${i}`,
            'X-Forwarded-Proto': 'https',
          },
          body: {
            email: i % 2 ? 'OWNER@EXAMPLE.INVALID' : 'other@example.invalid',
            password: 'wrong',
          },
        })
        assert.equal(r.status, i < 5 ? 401 : 429)
        if (i >= 5) assert.ok(Number(r.headers.get('retry-after')) > 0)
      }
      assert.equal((await db.prepare('SELECT max(failures) n FROM login_limits').first()).n, 8)
      await db.prepare('DELETE FROM login_limits').run()
    },
  )
  await checks(
    'missing settings and AUTH_VERSION rotation cannot reuse an authenticated cookie',
    async () => {
      for (const field of [
        'ADMIN_PASSWORD',
        'ADMIN_EMAIL',
        'AUTH_VERSION',
        'AUTH_RATE_LIMIT_SECRET',
      ]) {
        const bindings = { ...env }
        delete bindings[field]
        await mf.setOptions(options(bindings))
        assert.equal(
          (
            await request('/api/auth/login', {
              method: 'POST',
              headers: { Origin: origin },
              body: { email: env.ADMIN_EMAIL, password },
            })
          ).status,
          503,
        )
        assert.equal(
          (await (await request('/api/dashboard', { cookie: second.cookie })).json()).viewer,
          'guest',
        )
      }
      await mf.setOptions(options({ ...env, AUTH_VERSION: '2' }))
      assert.equal(
        (await (await request('/api/auth/session', { cookie: second.cookie })).json()).viewer,
        'guest',
      )
      await mf.setOptions(options())
    },
  )
  await checks(
    'production HTTPS always uses __Host Secure cookie and ignores forwarded-proto relaxation',
    async () => {
      const secure = 'https://dashboard.example.invalid'
      await mf.setOptions(options({ ...env, AUTH_ORIGIN: secure, AUTH_ALLOW_LOCAL_HTTP: '0' }))
      const r = await request('/api/auth/login', {
        target: secure,
        method: 'POST',
        headers: { Origin: secure, 'X-Forwarded-Proto': 'http' },
        body: { email: env.ADMIN_EMAIL, password },
      })
      assert.equal(r.status, 200)
      const cookie = r.headers.get('set-cookie')
      assert.ok(
        cookie.startsWith('__Host-nozoki_session=') &&
          cookie.includes('Secure') &&
          !cookie.includes('Domain='),
      )
      const wrong = await request('/api/auth/session', { cookie: cookie.split(';')[0] })
      assert.equal((await wrong.json()).viewer, 'guest')
      await mf.setOptions(options())
    },
  )
  await checks(
    'missing DB, unmigrated D1 and unavailable sessions fail closed without internal error text',
    async () => {
      for (const id of [null, 'not-migrated']) {
        await mf.setOptions(options(env, id))
        const r = await request('/api/auth/login', {
          method: 'POST',
          headers: { Origin: origin },
          body: { email: env.ADMIN_EMAIL, password },
        })
        assert.equal(r.status, 503)
        const text = await r.text()
        for (const marker of ['SELECT', 'INSERT', 'stack', password])
          assert.ok(!text.includes(marker))
      }
      await mf.setOptions(options())
      const current = await mf.getD1Database('DB')
      await current.prepare('ALTER TABLE session_bindings RENAME TO hidden_bindings').run()
      assert.equal((await request('/api/auth/session', { cookie: second.cookie })).status, 503)
      assert.equal((await request('/api/dashboard', { cookie: second.cookie })).status, 503)
      await current.prepare('ALTER TABLE hidden_bindings RENAME TO session_bindings').run()
    },
  )
  if (process.env.SKIP_AUTH_BROWSER !== '1') {
    browser = await launch()
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }),
      page = await context.newPage()
    page.on('pageerror', (error) => report.errors.push(error.message))
    page.on('console', (message) => {
      if (/hydration|mismatch/i.test(message.text())) report.errors.push(message.text())
    })
    await page.goto(origin + '/login')
    await settle(page)
    await page.getByLabel('邮箱', { exact: true }).fill(env.ADMIN_EMAIL)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '显示密码', exact: true }).press('Enter')
    assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'text')
    await page.getByRole('button', { name: '隐藏密码', exact: true }).click()
    await page.screenshot({ path: `${evidence}/login-desktop.png` })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(
      () => document.querySelector('.nozoki-app')?.getAttribute('data-color-mode') === 'dark',
    )
    // Varlet input color has a documented 250ms CSS transition; capture its settled state.
    await page.waitForTimeout(350)
    report.loginDark = await page.locator('.auth-card').evaluate((card) => {
      const input = card.querySelector('input[type=password]'),
        button = card.querySelector('button[type=submit]')
      return {
        background: getComputedStyle(card).backgroundColor,
        input: getComputedStyle(input).color,
        textFill: getComputedStyle(input).webkitTextFillColor,
        button: getComputedStyle(button).color,
        buttonBackground: getComputedStyle(button).backgroundColor,
      }
    })
    await page.screenshot({ path: `${evidence}/login-dark.png` })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForFunction(
      () => document.querySelector('.nozoki-app')?.getAttribute('data-color-mode') === 'light',
    )
    await page.getByLabel('密码', { exact: true }).press('Enter')
    await page.waitForURL('**/admin')
    await page.reload()
    await page.getByRole('heading', { name: '站点管理', exact: true }).waitFor()
    await page.screenshot({ path: `${evidence}/admin-desktop.png` })
    const tab = await context.newPage()
    await tab.goto(origin + '/admin')
    await settle(tab)
    const cookies = await context.cookies()
    const cookie = cookies.find((c) => c.name === 'nozoki_dev_session')
    assert.ok(cookie.httpOnly && cookie.sameSite === 'Strict')
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    )
    assert.ok(!storage.includes(cookie.value))
    assert.equal(await page.evaluate(() => document.cookie.includes('nozoki_dev_session')), false)
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes('nozoki_dev_session'),
      ),
      false,
    )
    await page.getByRole('button', { name: '注销', exact: true }).click()
    await page.waitForURL('**/login')
    await tab.reload()
    await tab.waitForURL('**/login')
    report.browser.push(
      'login, show/hide, refresh, HttpOnly cookie, server logout and second-tab revocation',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(origin + '/login')
    await settle(page)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${evidence}/login-mobile.png` })
    report.browser.push('390px login, no horizontal overflow')
    const blocked = await browser.newContext(),
      blockedPage = await blocked.newPage()
    await blockedPage.route('**/api/auth/login', async (route) => {
      const response = await route.fetch()
      const headers = response.headers()
      delete headers['set-cookie']
      // route.fetch uses this context's cookie jar too; remove its upstream Set-Cookie side effect.
      await blocked.clearCookies()
      await route.fulfill({ response, headers })
    })
    await blockedPage.goto(origin + '/login')
    await settle(blockedPage)
    await blockedPage.getByLabel('邮箱', { exact: true }).fill(env.ADMIN_EMAIL)
    await blockedPage.getByLabel('密码', { exact: true }).fill(password)
    await blockedPage.getByRole('button', { name: '登录', exact: true }).click()
    await blockedPage.getByRole('alert').filter({ hasText: 'Cookie' }).waitFor()
    report.browser.push('simulated browser cookie rejection is detected without redirect loop')
    await blocked.close()
    const nojs = await browser.newContext({ javaScriptEnabled: false }),
      nojsPage = await nojs.newPage()
    await nojsPage.goto(origin + '/')
    assert.ok(await nojsPage.getByRole('heading', { name: 'Nozoki 摸鱼看板' }).count())
    await nojs.close()
    report.browser.push('JavaScript disabled SSR dashboard remains available')
    await page.goto(origin + '/?fixture=edge&role=admin')
    await settle(page)
    assert.equal(await page.locator('[data-module]').count(), 7)
    assert.equal(await page.getByText('开发预览', { exact: false }).count(), 0)
    assert.equal(await page.locator('.dx-transition').count(), 0)
    const mode = await page.locator('.nozoki-app').getAttribute('data-color-mode')
    await page.getByRole('button', { name: /切换到亮色模式|切换到暗色模式/ }).click()
    assert.notEqual(await page.locator('.nozoki-app').getAttribute('data-color-mode'), mode)
    await page.getByRole('button', { name: '显示纯壁纸', exact: true }).click()
    assert.equal(await page.getByRole('button').filter({ visible: true }).count(), 1)
    await page.getByRole('button', { name: '恢复看板', exact: true }).click()
    assert.equal(await page.locator('.dx-transition').count(), 0)
    await page.getByRole('button', { name: '外观偏好', exact: true }).click()
    const slider = page.getByRole('slider', { name: '水平位置', exact: true })
    const track = page
      .locator('.setting-slider')
      .filter({ has: slider })
      .locator('.var-slider__horizontal-block')
    await track.scrollIntoViewIfNeeded()
    const rect = await track.boundingBox()
    await page.mouse.click(rect.x + rect.width * 0.25, rect.y + rect.height / 2)
    assert.ok(Math.abs(Number(await slider.getAttribute('aria-valuenow')) - 25) <= 1)
    await slider.press('Home')
    await slider.press('ArrowRight')
    assert.equal(await slider.getAttribute('aria-valuenow'), '1')
    assert.ok((await page.locator('svg.app-icon path').count()) > 6)
    report.browser.push(
      'seven modules, theme, wallpaper, DX cleanup, Slider keyboard, Material Symbols and production fixture isolation',
    )
    assert.deepEqual(report.errors, [])
    await context.close()
  }
} finally {
  await browser?.close()
  await mf.dispose()
  await writeFile(`${evidence}/auth-http.json`, JSON.stringify(report, null, 2))
}
console.log(
  JSON.stringify({
    checks: report.checks.length,
    browser: report.browser.length,
    errors: report.errors.length,
  }),
)
