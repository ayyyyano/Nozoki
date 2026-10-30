// Actual production Modules Worker + D1. Outbound network replaced only by Miniflare's
// host-side test harness, never by a production environment flag or HTTP parameter.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { credentialKeys } from '../../server/services/credential-keys.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { balance, source } from '../fixtures/adapters.ts'
import { launch, settle } from '../browser/support.mjs'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler'),
  evidence = '.wrangler/test-results/phase-05'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase05-http', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase05-http/run-')),
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
const origin = 'http://127.0.0.1:8795',
  password = 'SYNTHETIC-' + crypto.randomUUID(),
  sourceKey = 'SYNTHETIC-UPSTREAM-' + crypto.randomUUID()
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
let mode = 'success',
  calls = 0,
  active = 0,
  peak = 0,
  unblock,
  started
const delayed = []
let upstreamWallMs = 0
const outbound = async (request) => {
  const start = performance.now()
  calls++
  active++
  peak = Math.max(peak, active)
  try {
    assert.equal(request.url, 'https://api.deepseek.com/user/balance')
    assert.equal(request.method, 'GET')
    assert.ok(
      request.headers.get('authorization') === 'Bearer ' + sourceKey,
      'only the decrypted source credential is sent',
    )
    assert.equal(request.headers.get('cookie'), null)
    if (mode === 'hold') {
      started?.()
      await new Promise((r) => (unblock = r))
    }
    if (mode === 'hold-many') {
      started?.()
      await new Promise((r) => delayed.push(r))
    }
    if (mode === 'redirect')
      return new Response('', { status: 302, headers: { Location: 'https://evil.invalid/steal' } })
    if (mode === '429')
      return new Response('PRIVATE-UPSTREAM-ERROR', {
        status: 429,
        headers: { 'Retry-After': '120' },
      })
    if (mode === '401') return new Response('PRIVATE-UPSTREAM-ERROR', { status: 401 })
    return new Response(JSON.stringify(balance), {
      headers: { 'Content-Type': 'application/json' },
    })
  } finally {
    upstreamWallMs += performance.now() - start
    active--
  }
}
function options(bindings = env) {
  const opts = convertV4MiniflareOptions({
    modules,
    modulesRoot: root,
    port: 8795,
    host: '127.0.0.1',
    compatibilityDate: '2026-10-19',
    compatibilityFlags: ['nodejs_compat'],
    bindings,
    d1Databases: { DB: 'phase05-http' },
    outboundService: outbound,
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
  runtime: 'production Modules Worker; isolated Miniflare copy; host-side offline HTTP fixture',
  persist,
  checks: [],
  browser: [],
  calls: 0,
  peak: 0,
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
    upstreamRequests: calls - before,
  })
}
const request = (path, { method = 'GET', body, headers = {}, auth = true } = {}) =>
  mf.dispatchFetch(origin + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
const probe = (id = 'fixture', extra = {}) =>
  request('/api/admin/integrations/' + encodeURIComponent(id) + '/test', {
    method: 'POST',
    body: {},
    headers: { Origin: origin, 'X-Nozoki-CSRF': csrf },
    ...extra,
  })
const clearTestLimits = async () => {
  await db.prepare('DELETE FROM login_limits').run()
  await db
    .prepare(
      "UPDATE integration_test_slots SET request_token=NULL,expires_at='1970-01-01T00:00:00.000Z'",
    )
    .run()
}
const tables = [
  'site_settings',
  'dashboard_modules',
  'integrations',
  'integration_audit',
  'integration_snapshots',
  'integration_snapshot_views',
  'collection_runs',
  'daily_usage',
]
const business = () =>
  Promise.all(
    tables.map(
      async (table) => (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results,
    ),
  )
try {
  await mf.ready
  db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  const c = await readConfig(db),
    config = editableConfig(c),
    { credentialState: _, ...base } = source('deepseek')
  config.integrations = [
    {
      ...base,
      baseUrl: 'https://api.deepseek.com/',
      credential: { operation: 'replace', value: sourceKey },
    },
    {
      ...base,
      id: 'private',
      provider: 'sleepy',
      protocolVersion: 'sleepy-v5-status',
      baseUrl: 'https://home.example.invalid/',
      credential: { operation: 'keep' },
    },
    {
      ...base,
      id: 'disabled',
      baseUrl: 'https://api.deepseek.com/',
      enabled: false,
      credential: { operation: 'keep' },
    },
  ]
  assert.equal(
    (
      await saveConfig(
        db,
        { expectedVersion: c.site.configVersion, config },
        { actor: { kind: 'system' }, keys: await credentialKeys(env) },
      )
    ).success,
    true,
  )
  await check('guest and spoofed roles cannot initiate outbound requests', async () => {
    assert.equal((await probe('fixture', { auth: false })).status, 401)
    assert.equal(
      (
        await probe('fixture', {
          auth: false,
          headers: { Origin: origin, 'X-Admin': 'true', Cookie: 'role=admin' },
        })
      ).status,
      401,
    )
    assert.equal(calls, 0)
  })
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: env.ADMIN_EMAIL, password },
    headers: { Origin: origin },
    auth: false,
  })
  assert.equal(login.status, 200)
  cookie = login.headers.get('set-cookie').split(';')[0]
  csrf = (await (await request('/api/auth/csrf')).json()).token
  await check(
    'Origin CSRF Content-Type body override size and unknown IDs reject before outbound',
    async () => {
      for (const headers of [
        { Origin: origin },
        { Origin: 'https://evil.invalid', 'X-Nozoki-CSRF': csrf },
        { Origin: 'null', 'X-Nozoki-CSRF': csrf },
      ])
        assert.equal((await probe('fixture', { headers })).status, 403)
      assert.equal(
        (await probe('fixture', { body: { baseUrl: 'https://evil.invalid', credential: 'steal' } }))
          .status,
        400,
      )
      assert.equal((await probe('fixture', { body: '{' })).status, 400)
      assert.equal((await probe('fixture', { body: 'x'.repeat(4097) })).status, 413)
      assert.equal((await probe('missing')).status, 404)
      assert.equal(calls, 0)
    },
  )
  await check(
    'disabled/custom/private target refuses without outbound or credential forwarding',
    async () => {
      assert.equal((await (await probe('disabled')).json()).code, 'SOURCE_DISABLED')
      assert.equal((await (await probe('private')).json()).code, 'TARGET_NOT_APPROVED')
      assert.equal(calls, 0)
    },
  )
  await check(
    'real Worker decrypts v1 and validates response; minimal no-store result; no telemetry/config writes',
    async () => {
      await clearTestLimits()
      const before = await business(),
        r = await probe()
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('cache-control'), 'private, no-store')
      const value = await r.json()
      assert.equal(value.status, 'ok')
      assert.equal(value.protocolMatched, true)
      assert.equal(value.authentication, 'accepted')
      assert.equal(value.capabilities.balance.verified, true)
      assert.equal(value.capabilities.spend.supported, false)
      assert.equal(calls, 1)
      assert.deepEqual(await business(), before)
      for (const marker of [
        sourceKey,
        password,
        env.INTEGRATION_ENCRYPTION_KEY,
        'ciphertext',
        'iv',
        'balance_infos',
        '110.000000000000000001',
      ])
        assert.ok(
          !JSON.stringify(value).includes(marker),
          marker.length < 12 ? marker : 'secret marker',
        )
    },
  )
  await check(
    'redirect is rejected without forwarding credentials; 401 not retried; 429 persisted backoff',
    async () => {
      for (const [value, code] of [
        ['redirect', 'REDIRECT_REJECTED'],
        ['401', 'AUTH_REQUIRED'],
        ['429', 'RATE_LIMITED'],
      ]) {
        await clearTestLimits()
        mode = value
        const n = calls,
          r = await (await probe()).json()
        assert.equal(r.code, code)
        assert.equal(calls, n + 1)
        assert.ok(!JSON.stringify(r).includes('PRIVATE-UPSTREAM-ERROR'))
      }
      const n = calls
      assert.equal((await probe()).status, 429)
      assert.equal(calls, n)
      mode = 'success'
    },
  )
  await check(
    'missing key and tampered AAD fail before outbound; retained old version still works',
    async () => {
      await clearTestLimits()
      const n = calls,
        { INTEGRATION_ENCRYPTION_KEY: old, ...without } = env
      await mf.setOptions(options(without))
      db = await mf.getD1Database('DB')
      assert.equal((await (await probe()).json()).code, 'CREDENTIAL_UNAVAILABLE')
      assert.equal(calls, n)
      await mf.setOptions(
        options({
          ...env,
          INTEGRATION_ENCRYPTION_KEY: randomToken(),
          INTEGRATION_KEY_VERSION: 'v2',
          INTEGRATION_DECRYPTION_KEYS: JSON.stringify({ v1: old }),
        }),
      )
      db = await mf.getD1Database('DB')
      await clearTestLimits()
      assert.equal((await (await probe()).json()).status, 'ok')
      await db
        .prepare("UPDATE integrations SET credential_key_version='v2' WHERE id='fixture'")
        .run()
      await clearTestLimits()
      const before = calls
      assert.equal((await (await probe()).json()).code, 'CREDENTIAL_INVALID')
      assert.equal(calls, before)
      await db
        .prepare("UPDATE integrations SET credential_key_version='v1' WHERE id='fixture'")
        .run()
      await mf.setOptions(options())
      db = await mf.getD1Database('DB')
    },
  )
  await check(
    'config change during pending request invalidates verification; no slots remain',
    async () => {
      await clearTestLimits()
      mode = 'hold'
      const hasStarted = new Promise((r) => (started = r)),
        pending = probe()
      await hasStarted
      const c = await readConfig(db),
        config = editableConfig(c)
      config.site.siteName = 'Changed during test'
      assert.equal(
        (
          await saveConfig(
            db,
            { expectedVersion: c.site.configVersion, config },
            { actor: { kind: 'system' } },
          )
        ).success,
        true,
      )
      unblock()
      const value = await (await pending).json()
      assert.equal(value.code, 'SOURCE_CHANGED')
      assert.equal(value.status, 'stale')
      assert.equal(value.capabilities.balance.verified, false)
      assert.equal(
        (
          await db
            .prepare(
              'select count(*) n from integration_test_slots where request_token is not null',
            )
            .first()
        ).n,
        0,
      )
      mode = 'success'
      started = undefined
    },
  )
  await check(
    'three concurrent HTTP tests permit two outbound calls and reject the third',
    async () => {
      await clearTestLimits()
      const c = await readConfig(db),
        config = editableConfig(c)
      for (const id of ['parallel-a', 'parallel-b'])
        config.integrations.push({
          ...base,
          id,
          baseUrl: 'https://api.deepseek.com/',
          credential: { operation: 'replace', value: sourceKey },
        })
      assert.equal(
        (
          await saveConfig(
            db,
            { expectedVersion: c.site.configVersion, config },
            { actor: { kind: 'system' }, keys: await credentialKeys(env) },
          )
        ).success,
        true,
      )
      mode = 'hold-many'
      let timer
      const ready = new Promise((resolve, reject) => {
        started = () => {
          if (active === 2) resolve()
        }
        timer = setTimeout(() => reject(new Error('concurrent requests did not start')), 3000)
      })
      const a = probe('parallel-a'),
        b = probe('parallel-b')
      try {
        await ready
        assert.equal((await probe('fixture')).status, 429)
        assert.equal(active, 2)
      } finally {
        clearTimeout(timer)
        for (const done of delayed.splice(0)) done()
        started = undefined
        mode = 'success'
      }
      assert.equal((await (await a).json()).status, 'ok')
      assert.equal((await (await b).json()).status, 'ok')
      assert.equal(peak, 2)
    },
  )
  await check('browser explicit test only, saved-source gating and redacted status', async () => {
    await clearTestLimits()
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
    const n = calls
    await page.goto(origin + '/admin')
    await settle(page)
    await page.getByRole('button', { name: '数据源', exact: true }).click()
    assert.equal(calls, n)
    const editors = page
      .locator('.admin-item')
      .filter({ has: page.getByLabel('来源 ID', { exact: true }) })
    let editor
    for (let index = 0; index < (await editors.count()); index++) {
      const candidate = editors.nth(index)
      if ((await candidate.getByLabel('来源 ID', { exact: true }).inputValue()) === 'fixture') {
        editor = candidate
        break
      }
    }
    assert.ok(editor)
    const button = editor.getByRole('button', { name: '只读测试连接', exact: true })
    await button.click()
    await editor
      .getByRole('status')
      .getByText(/协议校验通过/)
      .waitFor()
    assert.equal(calls, n + 1)
    await page.screenshot({ path: evidence + '/admin-test-desktop.png', fullPage: true })
    mode = 'hold'
    let timer
    const ready = new Promise((resolve, reject) => {
      started = resolve
      timer = setTimeout(() => reject(new Error('browser request did not start')), 3000)
    })
    const finished = page.waitForResponse(
      (r) =>
        r.url() === origin + '/api/admin/integrations/fixture/test' &&
        r.request().method() === 'POST',
    )
    await button.click()
    await ready
    await editor
      .getByLabel('服务根 HTTPS 地址', { exact: true })
      .fill('https://api.deepseek.com/new')
    clearTimeout(timer)
    unblock()
    started = undefined
    mode = 'success'
    await finished
    await page.waitForFunction(() => !document.querySelector('.var-button--loading'))
    assert.equal(
      await editor.getByRole('status').count(),
      0,
      'late result must not verify an edited target',
    )
    assert.equal(calls, n + 2)
    await button.isDisabled().then((v) => assert.ok(v))
    assert.ok(!(await page.locator('body').innerText()).includes(sourceKey))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: evidence + '/admin-test-mobile.png', fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(errors, [])
    report.browser.push(
      'Edge: no automatic upstream call; one call per click; edited target discards pending result; desktop/mobile no overflow; no plaintext',
    )
    await context.close()
  })
  await check('logout, expiry and D1 admission faults prevent outbound', async () => {
    await clearTestLimits()
    const n = calls
    assert.equal(
      (
        await request('/api/auth/logout', {
          method: 'POST',
          body: {},
          headers: { Origin: origin, 'X-Nozoki-CSRF': csrf },
        })
      ).status,
      200,
    )
    assert.equal((await probe()).status, 401)
    assert.equal(calls, n)
    const relogin = async () => {
      const r = await request('/api/auth/login', {
        method: 'POST',
        body: { email: env.ADMIN_EMAIL, password },
        headers: { Origin: origin },
        auth: false,
      })
      assert.equal(r.status, 200)
      cookie = r.headers.get('set-cookie').split(';')[0]
      csrf = (await (await request('/api/auth/csrf')).json()).token
    }
    await relogin()
    await db
      .prepare(
        "UPDATE sessions SET created_at='2020-01-01T00:00:00.000Z',last_seen_at='2020-01-01T00:00:00.000Z',expires_at='2020-01-02T00:00:00.000Z',idle_expires_at='2020-01-01T00:30:00.000Z' WHERE revoked_at IS NULL",
      )
      .run()
    assert.equal((await probe()).status, 401)
    assert.equal(calls, n)
    await relogin()
    await clearTestLimits()
    await db
      .prepare(
        "CREATE TRIGGER adapter_test_admission_fault BEFORE INSERT ON login_limits BEGIN SELECT RAISE(ABORT,'SYNTHETIC_D1_FAILURE');END",
      )
      .run()
    assert.equal((await probe()).status, 503)
    assert.equal(calls, n)
  })
  report.calls = calls
  report.peak = peak
  report.upstreamFixtureWallMs = Math.round(upstreamWallMs)
  report.workersCpuMs = null
  report.d1OperationMs = null
  console.log(
    JSON.stringify({ checks: report.checks.length, browser: report.browser, calls, peak, persist }),
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  report.calls = calls
  report.peak = peak
  await browser?.close()
  await mf.dispose()
  await writeFile(evidence + '/adapters-http.json', JSON.stringify(report, null, 2))
}
