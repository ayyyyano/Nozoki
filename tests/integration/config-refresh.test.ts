// Isolated D1 and synthetic upstream responses; no live site or provider is modified.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { tencentFixtures } from '../fixtures/tencent-quotes.ts'
import { expect } from 'playwright/test'

const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
      ),
    )
  ).flat()
}

test(
  'saved config collects immediately without Cron; browser polls and synchronizes tabs',
  { timeout: 180000 },
  async (t) => {
    const origin = 'http://127.0.0.1:8814',
      root = resolve('.output/server')
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
    const password = 'FIXTURE-' + crypto.randomUUID()
    let requests = 0,
      release,
      gate = new Promise((r) => {
        release = r
      }),
      limited = false
    const opts = convertV4MiniflareOptions({
      modules,
      modulesRoot: root,
      port: 8814,
      host: '127.0.0.1',
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: { DB: 'config-refresh-fixture' },
      bindings: {
        ADMIN_EMAIL: 'owner@example.invalid',
        ADMIN_PASSWORD: password,
        AUTH_RATE_LIMIT_SECRET: randomToken(),
        AUTH_ORIGIN: origin,
        AUTH_ALLOW_LOCAL_HTTP: '1',
        AUTH_VERSION: '1',
        COLLECTOR_EPOCH: '1',
      },
      assets: {
        directory: resolve('.output/public'),
        routerConfig: { has_user_worker: true },
        assetConfig: {},
      },
      outboundService: async (req) => {
        const url = new URL(req.url)
        assert.equal(url.origin, 'https://web.ifzq.gtimg.cn')
        assert.equal(req.headers.get('authorization'), null)
        requests++
        await gate
        if (limited)
          return new Response('fixture rate limit', {
            status: 429,
            headers: { 'Retry-After': '3600' },
          })
        return Response.json(tencentFixtures[url.searchParams.get('param').split(',')[0].slice(2)])
      },
    })
    opts.resourcePersistencePath = await mkdtemp(resolve('.wrangler/config-refresh-worker-'))
    const mf = new Miniflare(opts)
    let browser
    t.after(async () => {
      release()
      if (browser) await browser.close()
      await mf.dispose()
    })
    await mf.ready
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    let cookie = '',
      csrf = ''
    const request = (path, method = 'GET', body, headers = {}) =>
      mf.dispatchFetch(origin + path, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== 'GET'
            ? { 'Content-Type': 'application/json', Origin: origin, 'X-Nozoki-CSRF': csrf }
            : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    assert.equal((await request('/api/admin/config', 'PUT', {})).status, 401)
    const login = await request('/api/auth/login', 'POST', {
      email: 'owner@example.invalid',
      password,
    })
    assert.equal(login.status, 200)
    cookie = login.headers.get('set-cookie').split(';')[0]
    csrf = (await (await request('/api/auth/csrf')).json()).token
    const input = async () => {
      const c = await (await request('/api/admin/config')).json()
      return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
    }
    const put = (value, key = crypto.randomUUID(), headers = {}) =>
      request('/api/admin/config', 'PUT', value, { 'Idempotency-Key': key, ...headers })
    let value = await input()
    value.config.quotes[0].refreshInterval++
    assert.equal((await put(value, crypto.randomUUID(), { 'X-Nozoki-CSRF': '' })).status, 403)
    assert.equal(requests, 0)
    const key = crypto.randomUUID(),
      response = await put(value, key)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).collection, 'scheduled')
    // HTTP returned while the provider was deliberately blocked: save does not await collection.
    release()
    await expect
      .poll(async () =>
        Number((await db.prepare('SELECT count(*) n FROM integration_snapshot_views').first()).n),
      )
      .toBe(1)
    assert.equal(requests, 2)
    const revision = (
      await db.prepare("SELECT collection_revision FROM integrations WHERE id='tencent'").first()
    ).collection_revision
    const quoteData = async () =>
      (await (await request('/api/dashboard')).json()).modules.find((m) => m.id === 'quotes')
        .snapshot.data
    assert.equal((await quoteData()).items.length, 2)
    const replay = await (await put(value, key)).json()
    assert.equal(replay.replayed, true)
    assert.equal(replay.collection, 'not_needed')
    assert.equal((await put(value)).status, 409)
    value = await input()
    value.config.site.siteName = 'Saved without collection'
    assert.equal((await (await put(value)).json()).collection, 'not_needed')
    assert.equal(
      (await db.prepare("SELECT collection_revision FROM integrations WHERE id='tencent'").first())
        .collection_revision,
      revision,
    )
    assert.equal((await quoteData()).items.length, 2)
    assert.equal(requests, 2)
    value = await input()
    value.config.quotes[0].refreshInterval++
    limited = true
    await put(value)
    await expect
      .poll(
        async () =>
          (
            await db
              .prepare("SELECT error_code FROM collection_state WHERE source_id='tencent'")
              .first()
          ).error_code,
      )
      .toBe('RATE_LIMITED')
    assert.equal(requests, 3)
    value = await input()
    value.config.quotes[0].refreshInterval++
    await put(value)
    await expect
      .poll(
        async () =>
          (
            await db
              .prepare("SELECT source_revision FROM collection_state WHERE source_id='tencent'")
              .first()
          ).source_revision,
      )
      .toBe(
        (
          await db
            .prepare(
              "SELECT collection_generation||':'||collection_revision revision FROM integrations WHERE id='tencent'",
            )
            .first()
        ).revision,
      )
    assert.equal(requests, 3, 'saving again cannot bypass Retry-After')

    await t.test(
      'browser tab synchronization',
      { skip: process.env.NOZOKI_TEST_BROWSER !== '1' },
      async () => {
        const { launch, settle } = await import('../browser/support.ts')
        browser = await launch()
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
        await context.addCookies([
          { name: 'nozoki_dev_session', value: cookie.split('=')[1], url: origin },
        ])
        const home = await context.newPage(),
          admin = await context.newPage(),
          errors = []
        home.on('pageerror', (e) => errors.push(e.message))
        admin.on('pageerror', (e) => errors.push(e.message))
        await home.clock.install()
        await home.goto(origin + '/')
        await settle(home)
        await admin.goto(origin + '/admin')
        await settle(admin)
        await admin
          .getByLabel('站点名称', { exact: true })
          .last()
          .fill('Browser synchronized fixture')
        await admin.getByRole('button', { name: '保存配置', exact: true }).click()
        await admin.getByText('已保存并确认持久化', { exact: true }).waitFor()
        await expect(home).toHaveTitle('Browser synchronized fixture')
        // A server-side update has no browser notification. Visible-page polling must discover it.
        await home.bringToFront()
        await home.waitForLoadState('networkidle')
        value = await input()
        value.config.site.siteName = 'Polled fixture'
        await put(value)
        await home.clock.fastForward(30001)
        await expect(home).toHaveTitle('Polled fixture')
        await home.route('**/api/dashboard', (route) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"code":"DATABASE_ERROR"}',
          }),
        )
        await home.clock.fastForward(30001)
        await expect(home).toHaveTitle('Polled fixture')
        assert.equal(
          await home.getByText('共享配置暂时不可用，请稍后刷新。', { exact: true }).count(),
          0,
        )
        await home.unroute('**/api/dashboard')
        // A hidden page must not poll, but becoming visible should refresh promptly.
        await home.evaluate(() =>
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
          }),
        )
        let reads = 0
        home.on('request', (r) => {
          if (new URL(r.url()).pathname === '/api/dashboard') reads++
        })
        await home.clock.fastForward(60001)
        assert.equal(reads, 0)
        value = await input()
        value.config.site.siteName = 'Visible again fixture'
        await put(value)
        await home.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
          })
          document.dispatchEvent(new Event('visibilitychange'))
        })
        await expect(home).toHaveTitle('Visible again fixture')
        assert.equal(requests, 3, 'browser reads and appearance saves never request upstream')
        assert.deepEqual(errors, [])
        await context.close()
      },
    )
  },
)
