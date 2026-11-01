// Actual production Modules Worker + D1. Outbound network replaced only by Miniflare's
// host-side test harness, never by a production environment flag or HTTP parameter.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { credentialKeys } from '../../server/services/credential-keys.ts'
import { randomToken, hashToken } from '../../server/services/auth-crypto.ts'
import { source } from '../fixtures/adapters.ts'
import { cpaSource, credentials } from '../fixtures/core051.ts'
import {
  createPrivateRelay,
  privateRoute,
  readPrivateSource,
} from '../../server/adapters/private-relay.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { launch, settle } from '../browser/support.mjs'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler'),
  evidence = '.wrangler/test-results/phase-05.1'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase051-http', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase051-http/run-')),
  root = resolve('.output/server')
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
const origin = 'http://127.0.0.1:8796',
  password = 'SYNTHETIC-' + crypto.randomUUID(),
  sourceKey = 'SYNTHETIC-UPSTREAM-' + crypto.randomUUID()
const s = cpaSource(),
  relayToken = randomToken()
const identitySecret = randomToken(),
  identityVersion = await hashToken(identitySecret)
const env = {
  ADMIN_EMAIL: 'owner@example.invalid',
  ADMIN_PASSWORD: password,
  AUTH_RATE_LIMIT_SECRET: randomToken(),
  AUTH_VERSION: '1',
  AUTH_ORIGIN: origin,
  AUTH_ALLOW_LOCAL_HTTP: '1',
  NOZOKI_PRIVATE_RELAY_TOKEN: relayToken,
  NOZOKI_PRIVATE_ROUTES: JSON.stringify([{ ...privateRoute(s), identityVersion }]),
}
let calls = 0,
  bindingCalls = 0,
  globalCalls = 0,
  fail = false,
  mode = 'normal'
const relay = await createPrivateRelay(
  [{ source: s, credential: sourceKey }],
  relayToken,
  async (input, init) => {
    calls++
    assert.equal(String(input), 'https://example.invalid/service/v8/management/credentials')
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'manual')
    assert.ok(new Headers(init.headers).get('authorization') === 'Bearer ' + sourceKey)
    assert.equal(new Headers(init.headers).get('cookie'), null)
    if (fail) return new Response('PRIVATE-ERROR-051', { status: 503 })
    const v = credentials(),
      date = new Date()
    v.observed_at = date.toISOString()
    v.files[0].quota.observed_at = date.toISOString()
    v.files[0].quota.signals['X-Codex-Primary-Reset-At'] = String(
      Math.floor(date.getTime() / 1000) + 3600,
    )
    v.files[2].cooldowns[0].retry_at = new Date(date.getTime() + 60000).toISOString()
    return Response.json(v)
  },
  identitySecret,
)
const binding = async (request) => {
  bindingCalls++
  assert.ok(request.headers.get('authorization') === 'Bearer ' + relayToken)
  assert.equal(request.headers.get('cookie'), null)
  return relay(new Request(request.url, { method: request.method, headers: request.headers }))
}
function options(bindings = env) {
  const opts = convertV4MiniflareOptions({
    modules,
    modulesRoot: root,
    port: 8796,
    host: '127.0.0.1',
    compatibilityDate: '2026-10-19',
    compatibilityFlags: ['nodejs_compat'],
    bindings,
    d1Databases: { DB: 'phase051-http' },
    serviceBindings: { NOZOKI_PRIVATE_RELAY: binding },
    outboundService: async () => {
      globalCalls++
      throw new Error('Unexpected hostname fetch')
    },
    assets: {
      directory: resolve('.output/public'),
      routerConfig: { has_user_worker: true },
      assetConfig: {},
    },
  })
  opts.resourcePersistencePath = persist
  return opts
}
let mf = new Miniflare(options()),
  db,
  cookie,
  csrf,
  browser
const report = {
  runtime:
    'actual production Nuxt Modules Worker + D1; isolated Miniflare copy; simulated Fetcher binding + real relay normalizer; no live VPC claim',
  persist,
  checks: [],
  measurements: [],
}
const check = async (name, fn) => {
  const start = performance.now(),
    before = calls
  await fn()
  report.checks.push(name)
  report.measurements.push({
    name,
    wallMs: Math.round(performance.now() - start),
    upstreamFixtureRequests: calls - before,
  })
}
const request = (path, { method = 'GET', body, headers = {}, auth = true } = {}) =>
  mf.dispatchFetch(origin + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const probe = (extra = {}) =>
  request('/api/admin/integrations/fixture/test', {
    method: 'POST',
    body: {},
    headers: { Origin: origin, 'X-Nozoki-CSRF': csrf },
    ...extra,
  })
const input = async () => {
  const c = await readConfig(db)
  return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
}
const save = async (i) => {
  const r = await saveConfig(db, i, { actor: { kind: 'system' } })
  assert.equal(r.success, true, JSON.stringify(r))
  return r
}
const limits = () => db.prepare('DELETE FROM login_limits').run()
try {
  await mf.ready
  db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  let i = await input()
  const { credentialState: _, ...sourceBase } = s
  i.config.modules.find((m) => m.id === 'quotes').sources = {}
  i.config.integrations = [{ ...sourceBase, credential: { operation: 'keep' } }]
  i.config.modules.find((m) => m.id === 'codex').sources.main = {
    sourceId: s.id,
    subject: 'default',
  }
  await save(i)
  await check('guest/spoofed role/CSRF rejection makes zero relay calls', async () => {
    assert.equal(
      (await probe({ auth: false, headers: { Origin: origin, 'X-Admin': 'true' } })).status,
      401,
    )
    assert.equal(bindingCalls, 0)
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { email: env.ADMIN_EMAIL, password },
      headers: { Origin: origin },
      auth: false,
    })
    assert.equal(login.status, 200)
    cookie = login.headers.get('set-cookie').split(';')[0]
    csrf = (await (await request('/api/auth/csrf')).json()).token
    assert.equal((await probe({ headers: { Origin: origin } })).status, 403)
    assert.equal(
      (await probe({ headers: { Origin: 'https://evil.invalid', 'X-Nozoki-CSRF': csrf } })).status,
      403,
    )
    assert.equal((await probe({ body: { baseUrl: 'https://evil.invalid' } })).status, 400)
    assert.equal(bindingCalls, 0)
  })
  await check(
    'saved source tests across actual Worker/D1/Fetcher and minimal safe response',
    async () => {
      const version = (await readConfig(db)).site.configVersion,
        audit = (await db.prepare('select count(*) n from integration_audit').first()).n
      const r = await probe()
      assert.equal(r.status, 200)
      const v = await r.json()
      assert.equal(v.status, 'ok')
      assert.equal(v.capabilities.accounts.verified, true)
      assert.equal(v.capabilities.quota.verified, true)
      assert.equal(v.capabilities.usage.supported, false)
      assert.equal(calls, 1)
      assert.equal(globalCalls, 0)
      assert.ok(!Object.hasOwn(v, 'views'))
      assert.ok(!Object.hasOwn(v, 'data'))
      for (const marker of [
        '@example.invalid',
        sourceKey,
        relayToken,
        'PRIVATE-ACCESS',
        'remainingPercent',
      ])
        assert.ok(!JSON.stringify(v).includes(marker))
      assert.equal((await readConfig(db)).site.configVersion, version)
      assert.equal((await db.prepare('select count(*) n from integration_audit').first()).n, audit)
      assert.equal((await db.prepare('select count(*) n from integration_snapshots').first()).n, 0)
    },
  )
  await check(
    'route root/mapping/revision mismatch rejects before forwarding local credential',
    async () => {
      await limits()
      i = await input()
      i.config.integrations[0].baseUrl = 'https://example.invalid/other/'
      i.config.integrations[0].credential = { operation: 'clear' }
      await save(i)
      const n = calls
      assert.equal((await (await probe()).json()).code, 'TARGET_NOT_APPROVED')
      assert.equal(calls, n)
      i = await input()
      i.config.integrations[0].baseUrl = s.baseUrl
      await save(i)
    },
  )
  await check(
    'isolated real D1 stores new optional fields and permissions remove every new private path',
    async () => {
      const result = await readPrivateSource(
        s,
        {
          ...env,
          NOZOKI_PRIVATE_RELAY: { fetch: (input, init) => relay(new Request(input, init)) },
        },
        'read',
      )
      assert.equal(result.status, 'ok')
      await upsertSnapshot(db, {
        sourceId: s.id,
        subject: 'default',
        moduleId: 'codex',
        snapshot: result.views.codex,
        updatedAt: new Date().toISOString(),
      })
      const admin = await (await request('/api/dashboard')).json()
      assert.equal(admin.viewer, 'admin')
      const data = admin.modules.find((m) => m.id === 'codex').snapshot.data
      assert.deepEqual(
        data.accounts.map((a) => a.state),
        ['ready', 'disabled', 'auth_error', 'pending'],
      )
      assert.equal(data.quota.accounts[0].windows[0].remainingPercent, '74.875')
      assert.equal(data.accounts[0].executionCounts.failed, 0)
      const guest = await (await request('/api/dashboard', { auth: false })).json()
      assert.equal(guest.modules.find((m) => m.id === 'codex').kind, 'login_required')
      assert.ok(!JSON.stringify(guest).includes('remainingPercent'))
      const id = data.accounts[0].id
      i = await input()
      const m = i.config.modules.find((m) => m.id === 'codex')
      m.visibility = 'public'
      m.fields = {
        '/accounts': { enabled: true, visibility: 'admin' },
        '/quota': { enabled: true, visibility: 'admin' },
      }
      await save(i)
      const hidden = await (await request('/api/dashboard', { auth: false })).json()
      assert.ok(!JSON.stringify(hidden).includes(id))
      assert.ok(!JSON.stringify(hidden).includes('74.875'))
      for (const path of [
        ['accounts', '@' + id, 'state'],
        ['accounts', '@' + id, 'executionCounts', 'failed'],
        ['quota', 'accounts', '@' + id, 'windows', '@primary', 'remainingPercent'],
        ['quota', 'accounts', '@' + id, 'windows', '*', 'observedAt'],
      ]) {
        i = await input()
        const mod = i.config.modules.find((m) => m.id === 'codex')
        mod.fields = { [fieldPointer(path)]: { enabled: true, visibility: 'admin' } }
        await save(i)
        const projected = await (await request('/api/dashboard', { auth: false })).json()
        const d = projected.modules.find((m) => m.id === 'codex').snapshot.data
        if (path.at(-1) === 'failed')
          assert.ok(!Object.hasOwn(d.accounts[0].executionCounts, 'failed'))
        else if (path[0] === 'accounts') assert.ok(!Object.hasOwn(d.accounts[0], 'state'))
        else if (path.at(-1) === 'remainingPercent')
          assert.ok(!Object.hasOwn(d.quota.accounts[0].windows[0], 'remainingPercent'))
        else assert.ok(!Object.hasOwn(d.quota.accounts[0].windows[0], 'observedAt'))
      }
      i = await input()
      i.config.modules.find((m) => m.id === 'codex').visibility = 'admin'
      i.config.modules.find((m) => m.id === 'codex').fields = {}
      await save(i)
      assert.deepEqual((await db.prepare('pragma foreign_key_check').all()).results, [])
    },
  )
  await check(
    'source failure leaves last successful D1 snapshot unchanged and never becomes down',
    async () => {
      await limits()
      const before = (await db.prepare('select * from integration_snapshot_views').all()).results
      fail = true
      const r = await (await probe()).json()
      assert.equal(r.status, 'error')
      assert.equal(r.code, 'UPSTREAM_UNAVAILABLE')
      assert.deepEqual(
        (await db.prepare('select * from integration_snapshot_views').all()).results,
        before,
      )
      fail = false
    },
  )
  await check(
    'actual browser shows account states/passive quota, has no raw credentials, guest SSR stays private',
    async () => {
      browser = await launch()
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }),
        page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await context.addCookies([
        {
          name: 'nozoki_dev_session',
          value: cookie.split('=')[1],
          url: origin,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ])
      await page.goto(origin)
      await settle(page)
      const card = page.locator('[data-module="codex"]')
      await card.getByText('来源就绪', { exact: true }).waitFor()
      await card.getByText('认证错误', { exact: true }).waitFor()
      assert.ok((await card.innerText()).includes('74.875'))
      assert.ok((await card.innerText()).includes('既往响应观测'))
      assert.ok(!(await page.locator('body').innerText()).includes('private-ready'))
      await page.screenshot({ path: evidence + '/codex-desktop.png', fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: evidence + '/codex-mobile.png', fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      assert.deepEqual(errors, [])
      const ssr = await (await request('/', { auth: false })).text()
      for (const marker of ['74.875', 'auth_error', sourceKey, 'PRIVATE-ACCESS'])
        assert.ok(!ssr.includes(marker))
      await context.close()
    },
  )
  await check(
    'no binding configuration falls back to no network, prior ACL DTOs still read after restart',
    async () => {
      await limits()
      const n = calls
      await mf.setOptions(options({ ...env, NOZOKI_PRIVATE_ROUTES: '[]' }))
      db = await mf.getD1Database('DB')
      assert.equal((await (await probe()).json()).code, 'TARGET_NOT_APPROVED')
      assert.equal(calls, n)
      assert.equal(globalCalls, 0)
      assert.equal(
        (await db.prepare('select count(*) n from integration_snapshot_views').first()).n,
        1,
      )
    },
  )
  report.calls = calls
  report.bindingCalls = bindingCalls
  report.globalFetches = globalCalls
  console.log(
    JSON.stringify({ checks: report.checks.length, calls, bindingCalls, globalCalls, persist }),
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  report.calls = calls
  report.bindingCalls = bindingCalls
  report.globalFetches = globalCalls
  await browser?.close()
  await mf.dispose()
  await writeFile(evidence + '/core-http.json', JSON.stringify(report, null, 2))
}
