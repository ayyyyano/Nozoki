import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createSourceConnector } from '../../platform/node/source-connector.mjs'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { source, sleepMeta, sleepStatus } from '../fixtures/adapters.ts'
import { launch, settle, select } from '../browser/support.mjs'
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
const root = resolve('.output/server'),
  modules = (await walk(root))
    .filter((p) => p.endsWith('.mjs'))
    .sort((a, b) =>
      a === resolve(root, 'index.mjs')
        ? -1
        : b === resolve(root, 'index.mjs')
          ? 1
          : a.localeCompare(b),
    )
    .map((path) => ({ type: 'ESModule', path }))
const script = (
  await build({
    entryPoints: ['tests/integration/source-access-worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    external: ['cloudflare:workers'],
  })
).outputFiles[0].text

test(
  'admin-managed sources: real Worker HTTP, isolated D1, pinned connector fixtures, collector and browser',
  { timeout: 180000 },
  async (t) => {
    const folder = await mkdtemp(resolve('.wrangler/source-access-test-')),
      evidence = resolve(folder, 'evidence')
    await mkdir(evidence)
    const origin = 'http://127.0.0.1:8808',
      token = randomToken(),
      password = 'Synthetic-' + randomToken()
    const env = {
      AUTH_ORIGIN: origin,
      AUTH_ALLOW_LOCAL_HTTP: '1',
      AUTH_VERSION: '1',
      ADMIN_EMAIL: 'access@example.invalid',
      ADMIN_PASSWORD: password,
      AUTH_RATE_LIMIT_SECRET: randomToken(),
      INTEGRATION_ENCRYPTION_KEY: randomToken(),
      INTEGRATION_KEY_VERSION: 'v1',
      COLLECTOR_EPOCH: '1',
      NOZOKI_CONNECTOR_TOKEN: token,
      NOZOKI_CONNECTOR_REVISION: 'fixture-1',
    }
    const upstream = []
    const handler = createSourceConnector(token, {
      lookup: async (host) => [
        { address: host.startsWith('blocked.') ? '127.0.0.1' : '93.184.216.34', family: 4 },
      ],
      request: (url, options, callback) => {
        upstream.push({ url: url.href, authorization: options.headers.Authorization })
        assert.equal(options.rejectUnauthorized, true)
        assert.equal(options.agent, false)
        const req = new EventEmitter()
        req.end = () =>
          queueMicrotask(() => {
            const res = new PassThrough()
            res.statusCode = 200
            res.headers = { 'content-type': 'application/json' }
            callback(res)
            const payload = url.pathname.endsWith('v8/management/credentials')
              ? {
                  observed_at: new Date().toISOString(),
                  files: [
                    {
                      auth_index: 'fixture-account-id',
                      provider: 'codex',
                      status: 'ready',
                      disabled: false,
                      unavailable: false,
                    },
                  ],
                }
              : url.pathname.endsWith('api/meta')
                ? sleepMeta
                : structuredClone(sleepStatus)
            if (payload.device) {
              payload.time = Date.now() / 1000
              payload.last_updated = payload.time
            }
            res.end(JSON.stringify(payload))
          })
        return req
      },
    })
    const common = {
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'source-access-isolated' },
      bindings: env,
      serviceBindings: {
        NOZOKI_SOURCE_CONNECTOR: async (request) =>
          handler(
            new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: await request.arrayBuffer(),
            }),
          ),
      },
      outboundService: () => {
        throw new Error('Direct upstream access forbidden in this fixture')
      },
    }
    const options = convertV4MiniflareOptions({
      port: 8808,
      host: '127.0.0.1',
      workers: [
        {
          ...common,
          name: 'dashboard',
          modules,
          modulesRoot: root,
          assets: {
            directory: resolve('.output/public'),
            routerConfig: { has_user_worker: true },
            assetConfig: {},
          },
        },
        { ...common, name: 'collector', modules: true, script },
      ],
    })
    options.resourcePersistencePath = folder
    let mf = new Miniflare(options),
      browser
    t.after(async () => {
      if (browser) await browser.close()
      await mf.dispose()
    })
    let db = await mf.getD1Database('DB', 'dashboard'),
      dash = await mf.getWorker('dashboard'),
      collector = await mf.getWorker('collector')
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    let cookie = '',
      csrf = ''
    const request = (path, method = 'GET', body, headers = {}) =>
      dash.fetch(origin + path, {
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
    assert.equal((await request('/api/admin/source-connector')).status, 401)
    const login = await request('/api/auth/login', 'POST', { email: env.ADMIN_EMAIL, password })
    assert.equal(login.status, 200)
    cookie = login.headers.get('set-cookie').split(';')[0]
    csrf = (await (await request('/api/auth/csrf')).json()).token
    const status = await request('/api/admin/source-connector')
    assert.deepEqual(await status.json(), { configured: true, environmentMatches: null })
    assert.match(status.headers.get('cache-control'), /no-store/)
    const input = async () => {
      const c = await (await request('/api/admin/config')).json()
      return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
    }
    const save = (value, key = crypto.randomUUID()) =>
      request('/api/admin/config', 'PUT', value, { 'Idempotency-Key': key })
    const approved = (id, host = 'source.example.com', authentication = 'none') => {
      const { credentialState: _, ...s } = source('sleepy')
      s.id = id
      s.baseUrl = 'https://' + host + '/service/'
      s.access = { mode: 'public', authentication, approved: true, approvedTarget: null }
      s.access.approvedTarget = sourceTargetKey(s, s.access)
      return { ...s, credential: { operation: 'keep' } }
    }
    let value = await input()
    for (const m of value.config.modules) m.sources = {}
    value.config.integrations = [approved('fixture'), approved('blocked', 'blocked.example.com')]
    const devices = value.config.modules.find((m) => m.id === 'devices')
    devices.enabled = true
    devices.visibility = 'public'
    devices.fields = {}
    devices.sources.main = { sourceId: 'fixture', subject: 'default' }
    const services = value.config.modules.find((m) => m.id === 'services')
    services.enabled = true
    services.sources.main = { sourceId: 'blocked', subject: 'default' }
    // CSRF refusal is checked with a fully valid config body.
    assert.equal(
      (
        await request('/api/admin/config', 'PUT', value, {
          'X-Nozoki-CSRF': '',
          'Idempotency-Key': crypto.randomUUID(),
        })
      ).status,
      403,
    )
    const key = crypto.randomUUID(),
      saved = await save(value, key)
    assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()))
    assert.equal((await (await save(value, key)).json()).replayed, true)
    assert.equal((await save(value)).status, 409)
    assert.equal(await db.prepare('SELECT epoch FROM collector_environment').first(), null)
    const probe = await request('/api/admin/integrations/fixture/test', 'POST', {})
    const probed = await probe.json()
    assert.equal(probed.protocolMatched, true, JSON.stringify(probed))
    assert.equal(upstream.length, 1)
    assert.equal(upstream[0].authorization, undefined)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_snapshots').first()).n, 0)
    const collected = await (await collector.fetch(origin + '/collect')).json()
    assert.equal(collected.fatal, null)
    assert.equal(
      collected.success,
      1,
      JSON.stringify({
        collected,
        runs: (await db.prepare('SELECT source_id,error_code FROM collection_runs').all()).results,
      }),
    )
    assert.equal(collected.failure, 1, JSON.stringify(collected))
    assert.equal(
      (
        await db
          .prepare("SELECT error_code FROM collection_state WHERE source_id='blocked'")
          .first()
      ).error_code,
      'DESTINATION_BLOCKED',
    )
    const dashboard = await (await request('/api/dashboard')).json()
    const deviceView = dashboard.modules.find((m) => m.id === 'devices').snapshot
    assert.equal(deviceView.status, 'ok')
    assert.ok(JSON.stringify(deviceView).includes('Synthetic device'))
    assert.ok(!JSON.stringify(dashboard).includes('approvedTarget'))
    assert.equal((await db.prepare('SELECT epoch FROM collector_environment').first()).epoch, 1)
    const before = upstream.length
    value = await input()
    value.config.integrations.find((s) => s.id === 'fixture').baseUrl =
      'https://changed.example.com/service/'
    assert.equal((await save(value)).status, 400)
    assert.equal(upstream.length, before)
    // Acquire an old lease, then revoke. Even direct completion with its old revision must fail.
    await db
      .prepare(
        "UPDATE collection_state SET next_run_at='1970-01-01T00:00:00.000Z',last_scheduled_at=NULL WHERE source_id='fixture'",
      )
      .run()
    const lease = await collector.acquire('fixture')
    assert.ok(lease)
    value = await input()
    value.config.integrations.find((s) => s.id === 'fixture').access.approved = false
    value.config.integrations.find((s) => s.id === 'fixture').access.approvedTarget = null
    assert.equal((await save(value)).status, 200)
    assert.equal(await collector.finish(lease), 'SOURCE_CHANGED')
    const revoked = await (await collector.fetch(origin + '/collect')).json()
    assert.equal(revoked.success, 0)
    assert.equal(upstream.length, before)
    const revocationAudit = (
      await db
        .prepare('SELECT changed_fields_json FROM integration_audit ORDER BY rowid DESC LIMIT 1')
        .first()
    ).changed_fields_json
    assert.match(revocationAudit, /integrations.access/)
    // Use a saved bearer credential through the same connector; only the exact approved endpoint sees it.
    value = await input()
    const first = value.config.integrations.find((s) => s.id === 'fixture')
    first.access.authentication = 'bearer'
    first.access.approved = true
    first.access.approvedTarget = sourceTargetKey(first, first.access)
    first.credential = { operation: 'replace', value: 'Synthetic-source-key' }
    assert.equal((await save(value)).status, 200)
    const bearerResult = await (await collector.fetch(origin + '/collect')).json()
    assert.equal(bearerResult.success, 1, JSON.stringify(bearerResult))
    assert.equal(upstream.at(-1).authorization, 'Bearer Synthetic-source-key')
    const adminText = await (await request('/api/admin/config')).text()
    assert.ok(!adminText.includes('Synthetic-source-key'))
    assert.ok(!adminText.includes('identityEnvelope'))
    // Codex account identity is generated once and survives credential replacement and retry.
    value = await input()
    const codex = approved('codex-fixture', 'codex.example.com', 'bearer')
    codex.provider = 'cliproxy-bridge'
    codex.protocolVersion = 'cliproxy-v8-accounts'
    codex.enabled = true
    codex.access.approvedTarget = sourceTargetKey(codex, codex.access)
    codex.credential = { operation: 'replace', value: 'Synthetic-management-key' }
    value.config.integrations.push(codex)
    const codexModule = value.config.modules.find((m) => m.id === 'codex')
    codexModule.enabled = true
    codexModule.visibility = 'admin'
    codexModule.sources.main = { sourceId: codex.id, subject: 'default' }
    const legacyCodex = structuredClone(value),
      legacySource = legacyCodex.config.integrations.find((s) => s.id === codex.id)
    legacySource.access = { mode: 'legacy' }
    legacySource.enabled = false
    legacyCodex.config.modules.find((m) => m.id === 'codex').fields = {
      '/accounts/@private-account/state': { enabled: false, visibility: 'admin' },
    }
    assert.equal((await save(legacyCodex)).status, 200)
    value = await input()
    value.config.integrations[value.config.integrations.findIndex((s) => s.id === codex.id)] = codex
    assert.equal((await save(value)).status, 400)
    assert.equal(
      (
        await db
          .prepare("SELECT identity_envelope_json FROM integrations WHERE id='codex-fixture'")
          .first()
      ).identity_envelope_json,
      null,
    )
    value.config.modules.find((m) => m.id === 'codex').fields = {}
    assert.equal((await save(value)).status, 200)
    const identity = (
      await db
        .prepare("SELECT identity_envelope_json FROM integrations WHERE id='codex-fixture'")
        .first()
    ).identity_envelope_json
    assert.ok(identity)
    assert.equal((await (await collector.fetch(origin + '/collect')).json()).success, 1)
    const codexSnapshot = () =>
      db
        .prepare(
          "SELECT snapshot_json FROM integration_snapshot_views WHERE source_id='codex-fixture' AND module_id='codex'",
        )
        .first()
    const accountId = JSON.parse((await codexSnapshot()).snapshot_json).data.accounts[0].id
    assert.match(accountId, /^[a-f0-9]{64}$/)
    assert.notEqual(accountId, 'fixture-account-id')
    value = await input()
    value.config.integrations.find((s) => s.id === 'codex-fixture').credential = {
      operation: 'replace',
      value: 'Synthetic-replacement-key',
    }
    assert.equal((await save(value)).status, 200)
    assert.equal(
      (
        await db
          .prepare("SELECT identity_envelope_json FROM integrations WHERE id='codex-fixture'")
          .first()
      ).identity_envelope_json,
      identity,
    )
    assert.equal((await (await collector.fetch(origin + '/collect')).json()).success, 1)
    assert.equal(JSON.parse((await codexSnapshot()).snapshot_json).data.accounts[0].id, accountId)
    const guest = await dash.fetch(origin + '/api/dashboard')
    assert.equal((await guest.json()).modules.find((m) => m.id === 'codex').kind, 'login_required')

    await mf.ready
    browser = await launch()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await context.addCookies([
      { name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: origin },
    ])
    const page = await context.newPage(),
      errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(origin + '/admin')
    await settle(page)
    await page.getByRole('button', { name: '选择管理分区', exact: true }).click()
    await page
      .getByRole('dialog', { name: '选择管理分区' })
      .getByRole('button', { name: '数据源', exact: true })
      .click()
    const scope = page
      .locator('.admin-editor-item')
      .filter({ has: page.getByRole('button', { name: /^fixture/ }) })
      .first()
    await scope.locator('.admin-item-toggle').click()
    await scope.getByRole('button', { name: '撤销批准', exact: true }).first().click()
    await scope.getByRole('button', { name: '批准此来源', exact: true }).first().click()
    const dialog = page.getByRole('alertdialog', { name: '批准来源访问？' })
    const settledDialog = () =>
      dialog.evaluate(async (el) => {
        for (let node = el; node; node = node.parentElement)
          await Promise.all(
            node
              .getAnimations()
              .filter((a) => a.effect?.getTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => {})),
          )
      })
    await expect(dialog).toBeVisible()
    await settledDialog()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(scope.getByRole('button', { name: '批准此来源', exact: true })).toBeFocused()
    await scope.getByRole('button', { name: '批准此来源', exact: true }).first().click()
    await dialog.getByRole('button', { name: '确认批准', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(scope.getByRole('button', { name: '撤销批准', exact: true })).toBeFocused()
    await scope.getByLabel('来源刷新间隔（秒）', { exact: true }).fill('75')
    await scope
      .getByLabel('服务根 HTTPS 地址', { exact: true })
      .fill('https://SOURCE.example.com/service')
    await expect(scope.getByRole('button', { name: '撤销批准', exact: true })).toBeVisible()
    const browserSaved = page.waitForResponse(
      (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    assert.equal((await browserSaved).status(), 200)
    await expect(page.getByText('已保存并确认持久化', { exact: true })).toBeVisible()
    await expect(scope.getByRole('button', { name: '撤销批准', exact: true })).toBeVisible()
    await expect(scope.getByLabel('服务根 HTTPS 地址', { exact: true })).toHaveValue(
      'https://source.example.com/service/',
    )
    await page.screenshot({ path: resolve(evidence, 'admin-managed-390.png'), fullPage: true })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    assert.deepEqual(errors, [])
    assert.equal((await page.locator('body').innerText()).includes('Token 用量'), false)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: resolve(evidence, 'admin-managed-1440.png'), fullPage: true })
    await page.setViewportSize({ width: 320, height: 844 })
    await scope.getByRole('button', { name: '撤销批准', exact: true }).click()
    await scope.getByRole('button', { name: '批准此来源', exact: true }).click()
    await expect(dialog).toBeVisible()
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    await settledDialog()
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.width >= 280 && bounds.x >= 0 && bounds.x + bounds.width <= 320)
    await page.screenshot({ path: resolve(evidence, 'approval-320.png') })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await context.close()
    await browser.close()
    browser = null
    await mf.dispose()
    mf = new Miniflare(options)
    db = await mf.getD1Database('DB', 'dashboard')
    dash = await mf.getWorker('dashboard')
    collector = await mf.getWorker('collector')
    assert.equal(
      (
        await db
          .prepare("SELECT identity_envelope_json FROM integrations WHERE id='codex-fixture'")
          .first()
      ).identity_envelope_json,
      identity,
    )
    assert.equal(
      JSON.parse(
        (await db.prepare("SELECT access_json FROM integrations WHERE id='fixture'").first())
          .access_json,
      ).approved,
      true,
    )
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    assert.equal(
      (await (await request('/api/admin/config')).json()).integrations.find(
        (s) => s.id === 'fixture',
      ).refreshInterval,
      75,
    )
    const beforeMismatch = upstream.length
    await mf.dispose()
    const changed = convertV4MiniflareOptions({
      ...common,
      bindings: { ...env, NOZOKI_CONNECTOR_REVISION: 'fixture-2' },
      modules,
      modulesRoot: root,
    })
    changed.resourcePersistencePath = folder
    mf = new Miniflare(changed)
    dash = await mf.getWorker()
    assert.deepEqual(await (await request('/api/admin/source-connector')).json(), {
      configured: true,
      environmentMatches: false,
    })
    const mismatched = await request('/api/admin/integrations/fixture/test', 'POST', {})
    assert.equal((await mismatched.json()).code, 'CONNECTOR_UNAVAILABLE')
    assert.equal(upstream.length, beforeMismatch)
    await writeFile(
      resolve(evidence, 'result.json'),
      JSON.stringify(
        {
          fixture: true,
          requests: upstream.length,
          checks: [
            'auth',
            'csrf',
            'CAS',
            'idempotency',
            'probe',
            'collect',
            'ACL',
            'blocked DNS',
            'revocation fences lease',
            'encrypted credentials',
            'stable Codex identity',
            'mobile approval focus',
            'restart',
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    )
  },
)
