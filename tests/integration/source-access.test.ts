import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir, mkdtemp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { hmacKey, mac, hex, randomToken } from '../../server/services/auth-crypto.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { saveConfig } from '../../server/services/config.ts'
import {
  source,
  sleepMeta,
  sleepStatus,
  balance,
  kumaMeta,
  kumaHearts,
  flare,
} from '../fixtures/adapters.ts'
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
  'admin-managed sources: real Worker HTTP, isolated D1, native public fetch fixtures, collector and browser',
  { timeout: 180000 },
  async (t) => {
    const folder = await mkdtemp(resolve('.wrangler/source-access-test-')),
      evidence = process.env.NOZOKI_SOURCE_UI_EVIDENCE ?? resolve(folder, 'evidence')
    if (process.env.NOZOKI_TEST_BROWSER === '1') await mkdir(evidence, { recursive: true })
    const origin = 'http://127.0.0.1:8808',
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
    }
    const upstream = []
    const common = {
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: { DB: 'source-access-isolated' },
      bindings: env,
      outboundService: async (request) => {
        const url = new URL(request.url)
        if (url.hostname.startsWith('blocked.')) throw new Error('Synthetic network refusal')
        if (url.hostname.startsWith('html.'))
          return new Response('<html>Fixture login</html>', {
            headers: { 'Content-Type': 'text/html' },
          })
        if (url.hostname.startsWith('redirect.'))
          return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/' } })
        if (url.pathname.endsWith('api/data'))
          return Response.json({
            ...flare,
            ...(process.env.NOZOKI_TEST_HOME_SUMMARY === '1'
              ? {
                  monitors: Object.fromEntries(
                    Array.from({ length: 10 }, (_, i) => [
                      'service-' + i,
                      { up: i !== 9, latency: i * 10 },
                    ]),
                  ),
                }
              : {}),
            updatedAt: Date.now() / 1000,
          })
        if (url.pathname.includes('api/status-page/heartbeat/')) return Response.json(kumaHearts)
        if (url.pathname.includes('api/status-page/')) return Response.json(kumaMeta)
        assert.equal(request.method, 'GET')
        assert.equal(request.headers.get('cookie'), null)
        upstream.push({ url: url.href, authorization: request.headers.get('authorization') })
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
          : url.pathname.endsWith('user/balance')
            ? structuredClone(balance)
            : url.pathname.endsWith('api/meta')
              ? sleepMeta
              : structuredClone(sleepStatus)
        if (payload.device) {
          payload.time = Date.now() / 1000
          payload.last_updated = payload.time
        }
        return Response.json(payload)
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
    assert.equal((await request('/api/admin/integrations/fixture/removal')).status, 401)
    assert.equal(
      (await request('/api/admin/integrations/new-draft/test', 'POST', { draft: {} })).status,
      401,
    )
    const login = await request('/api/auth/login', 'POST', { email: env.ADMIN_EMAIL, password })
    assert.equal(login.status, 200)
    cookie = login.headers.get('set-cookie').split(';')[0]
    csrf = (await (await request('/api/auth/csrf')).json()).token
    const status = await request('/api/admin/source-connector')
    assert.deepEqual(await status.json(), {
      configured: true,
      publicMode: 'worker',
      privateConfigured: false,
      environmentMatches: null,
    })
    assert.match(status.headers.get('cache-control'), /no-store/)
    const input = async () => {
      const c = await (await request('/api/admin/config')).json()
      return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
    }
    const save = (value, key = crypto.randomUUID()) =>
      request('/api/admin/config', 'PUT', value, { 'Idempotency-Key': key })
    if (
      process.env.NOZOKI_TEST_LIST_HEADERS === '1' ||
      process.env.NOZOKI_TEST_BACKGROUND === '1' ||
      process.env.NOZOKI_TEST_DEVICE_COLUMNS === '1' ||
      process.env.NOZOKI_TEST_CARD_METRICS === '1' ||
      process.env.NOZOKI_TEST_ONBOARDING === '1' ||
      process.env.NOZOKI_TEST_DATA_MANAGEMENT === '1' ||
      process.env.NOZOKI_TEST_HOME_SUMMARY === '1' ||
      process.env.NOZOKI_TEST_UNIFORM_GRID === '1' ||
      process.env.NOZOKI_TEST_COMPACT_GRID === '1'
    ) {
      const { launch, settle } = await import('../browser/support.ts')
      const { exerciseAdminListHeaders } = await import('../browser/admin-list-headers.ts')
      await mf.ready
      browser = await launch()
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      await context.addCookies([
        { name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: origin },
      ])
      const page = await context.newPage()
      await page.goto(origin + '/admin')
      await settle(page)
      if (process.env.NOZOKI_TEST_COMPACT_GRID === '1') {
        const { exerciseCompactGrid } = await import('../browser/compact-grid.ts')
        await exerciseCompactGrid(page, { origin, evidence })
      } else if (process.env.NOZOKI_TEST_UNIFORM_GRID === '1') {
        const { exerciseUniformGrid } = await import('../browser/uniform-grid.ts')
        await exerciseUniformGrid(page, { origin, input, request, save, db, evidence })
      } else if (process.env.NOZOKI_TEST_HOME_SUMMARY === '1') {
        const { exerciseHomeSummary } = await import('../browser/home-summary.ts')
        await exerciseHomeSummary(page, {
          origin,
          input,
          request,
          save,
          db,
          collector,
          env,
          evidence,
        })
      } else if (process.env.NOZOKI_TEST_DATA_MANAGEMENT === '1') {
        const { exerciseDataManagement } = await import('../browser/data-management.ts')
        await exerciseDataManagement(page, { input, request, save, evidence })
      } else if (process.env.NOZOKI_TEST_ONBOARDING === '1') {
        const { exerciseSourceOnboarding } = await import('../browser/source-onboarding.ts')
        await exerciseSourceOnboarding(page, {
          origin,
          input,
          request,
          save,
          db,
          collector,
          env,
          evidence,
        })
      } else if (process.env.NOZOKI_TEST_CARD_METRICS === '1') {
        const { exerciseCardMetrics } = await import('../browser/card-metrics.ts')
        await exerciseCardMetrics(page, { origin, evidence })
      } else if (process.env.NOZOKI_TEST_DEVICE_COLUMNS === '1') {
        const { exerciseDeviceColumns } = await import('../browser/device-columns.ts')
        await exerciseDeviceColumns(page, { origin, evidence })
      } else if (process.env.NOZOKI_TEST_BACKGROUND === '1') {
        const { exerciseSharedBackground } = await import('../browser/admin-background.ts')
        await exerciseSharedBackground(page, {
          browser,
          origin,
          input,
          request,
          save,
          db,
          evidence,
        })
      } else await exerciseAdminListHeaders(page, { input, evidence })
      await context.close()
      await browser.close()
      browser = null
      return
    }
    await t.test(
      'unsaved, disabled source probe preserves D1 config, ciphertext and snapshots',
      async () => {
        const initial = await input()
        const draft = createIntegrationDraft('deepseek', initial.config.integrations, 'probe')
        draft.credential = { operation: 'replace', value: 'Synthetic-transient-key' }
        const body = { expectedVersion: initial.expectedVersion, draft, quoteSymbols: [] }
        const path = '/api/admin/integrations/' + draft.id + '/test'
        const tables = [
          'integration_snapshots',
          'integration_snapshot_views',
          'collection_runs',
          'integration_audit',
        ]
        const beforeCounts = await Promise.all(
          tables.map((table) => db.prepare(`SELECT count(*) n FROM ${table}`).first()),
        )
        const sent = upstream.length
        assert.equal((await request(path, 'POST', body, { 'X-Nozoki-CSRF': '' })).status, 403)
        assert.equal(upstream.length, sent)
        const tested = await request(path, 'POST', body)
        const result = await tested.json()
        assert.equal(tested.status, 200, JSON.stringify(result))
        assert.equal(result.protocolMatched, true)
        assert.equal(upstream.at(-1).authorization, 'Bearer Synthetic-transient-key')
        assert.ok(!JSON.stringify(result).includes('Synthetic-transient-key'))
        assert.deepEqual(await input(), initial)
        assert.deepEqual(
          await Promise.all(
            tables.map((table) => db.prepare(`SELECT count(*) n FROM ${table}`).first()),
          ),
          beforeCounts,
        )
        const forged = structuredClone(body)
        forged.draft.access.authentication = 'none'
        assert.equal((await request(path, 'POST', forged)).status, 400)
        assert.equal(upstream.length, sent + 1)
        const stale = structuredClone(body)
        stale.expectedVersion++
        assert.equal((await request(path, 'POST', stale)).status, 409)
        await db.prepare('DELETE FROM login_limits').run()
        // Keep the existing collector assertions independent of this explicit probe.
        upstream.length = 0
      },
    )
    const approved = (id, host = 'source.example.com', authentication = 'none') => {
      const { credentialState: _, ...s } = source('sleepy')
      s.id = id
      s.baseUrl = 'https://' + host + '/service/'
      s.access = { mode: 'public', authentication, approved: true, approvedTarget: null }
      s.access.approvedTarget = sourceTargetKey(s, s.access)
      return { ...s, credential: { operation: 'keep' } }
    }
    const prove = async (value, ids) => {
      for (const id of ids) {
        const source = value.config.integrations.find((s) => s.id === id)
        const { identityCredential: _identity, connectionProof: _proof, ...draft } = source
        const result = await (
          await request('/api/admin/integrations/' + id + '/test', 'POST', {
            expectedVersion: value.expectedVersion,
            draft,
            quoteSymbols: [],
          })
        ).json()
        assert.ok(result.connectionProof, JSON.stringify(result))
        source.connectionProof = result.connectionProof
      }
    }
    let value = await input()
    for (const m of value.config.modules) m.sources = {}
    value.config.quotes.forEach((q) => {
      q.provider = null
    })
    value.config.integrations = [approved('fixture'), approved('blocked', 'blocked.example.com')]
    const blocked = value.config.integrations.find((s) => s.id === 'blocked')
    blocked.provider = 'uptimeflare'
    blocked.protocolVersion = 'uptimeflare-data-2024'
    blocked.access.approvedTarget = sourceTargetKey(blocked, blocked.access)
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
    // Import an unavailable legacy fixture internally; new sources use the tested onboarding path.
    assert.equal((await saveConfig(db, value, { actor: { kind: 'system' } })).success, true)
    value = await input()
    value.config.site.siteName = 'HTTP save fixture'
    const key = crypto.randomUUID(),
      saved = await save(value, key)
    assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()))
    assert.equal((await (await save(value, key)).json()).replayed, true)
    assert.equal((await save(value)).status, 409)
    await collector.fetch(origin + '/collect')
    await expect
      .poll(
        async () =>
          (
            await db
              .prepare("SELECT count(*) n FROM collection_runs WHERE status!='running'")
              .first()
          ).n,
      )
      .toBe(2)
    assert.equal((await db.prepare('SELECT epoch FROM collector_environment').first()).epoch, 1)
    const probe = await request('/api/admin/integrations/fixture/test', 'POST', {})
    const probed = await probe.json()
    assert.equal(probed.protocolMatched, true, JSON.stringify(probed))
    assert.equal(upstream.length, 2)
    assert.equal(upstream[0].authorization, null)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_snapshots').first()).n, 1)
    const collected = await (await collector.fetch(origin + '/collect')).json()
    assert.equal(collected.fatal, null)
    assert.equal(
      collected.success,
      0,
      JSON.stringify({
        collected,
        runs: (await db.prepare('SELECT source_id,error_code FROM collection_runs').all()).results,
      }),
    )
    assert.equal(collected.failure, 0, JSON.stringify(collected))
    assert.equal(
      (
        await db
          .prepare("SELECT error_code FROM collection_state WHERE source_id='blocked'")
          .first()
      ).error_code,
      'UPSTREAM_UNAVAILABLE',
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
    // The preset fixes authentication; a forged Sleepy auth mode cannot send a secret.
    value = await input()
    const first = value.config.integrations.find((s) => s.id === 'fixture')
    first.access.authentication = 'bearer'
    first.access.approved = true
    first.access.approvedTarget = sourceTargetKey(first, first.access)
    first.credential = { operation: 'replace', value: 'Synthetic-source-key' }
    assert.equal((await save(value)).status, 400)
    assert.equal(upstream.length, before)
    value = await input()
    const sleep = value.config.integrations.find((s) => s.id === 'fixture')
    sleep.access.approved = true
    sleep.access.approvedTarget = sourceTargetKey(sleep, sleep.access)
    // A fixed DeepSeek preset is the supported bearer flow.
    const deep = createIntegrationDraft('deepseek', value.config.integrations, 'http-fixture')
    deep.enabled = true
    deep.credential = { operation: 'replace', value: 'Synthetic-source-key' }
    value.config.integrations.push(deep)
    value.config.modules.find((m) => m.id === 'deepseek').sources.main = {
      sourceId: deep.id,
      subject: 'default',
    }
    await prove(value, [sleep.id, deep.id])
    assert.equal((await save(value)).status, 200)
    await expect
      .poll(
        () =>
          upstream.filter((r) => new URL(r.url).hostname === 'api.deepseek.com').at(-1)
            ?.authorization,
      )
      .toBe('Bearer Synthetic-source-key')
    const bearerResult = await (await collector.fetch(origin + '/collect')).json()
    assert.equal(bearerResult.fatal, null)
    assert.equal(
      upstream.filter((r) => new URL(r.url).hostname === 'api.deepseek.com').at(-1).authorization,
      'Bearer Synthetic-source-key',
    )
    const adminText = await (await request('/api/admin/config')).text()
    assert.ok(!adminText.includes('Synthetic-source-key'))
    assert.ok(!adminText.includes('identityEnvelope'))
    const removal = await (await request('/api/admin/integrations/' + deep.id + '/removal')).json()
    assert.equal(removal.protectedHistory, true)
    assert.equal(removal.hasSnapshots, true)
    assert.deepEqual(Object.keys(removal).sort(), ['exists', 'hasSnapshots', 'protectedHistory'])
    for (const mutate of [
      (s) => {
        s.provider = 'sleepy'
      },
      (s) => {
        s.protocolVersion = 'unknown'
      },
      (s) => {
        s.capabilities.fake = { supported: true, verified: true }
      },
      (s) => {
        s.fieldMappings.unknown = 'arbitrary.path'
      },
    ]) {
      const forged = await input()
      mutate(forged.config.integrations.find((s) => s.id === deep.id))
      assert.equal((await save(forged)).status, 400)
    }
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
    const importedIdentity = randomToken()
    const expectedAccountId = hex(
      await mac(await hmacKey(importedIdentity), [
        'nozoki-codex-account-v1',
        codex.id,
        'fixture-account-id',
      ]),
    )
    const legacyCodex = structuredClone(value),
      legacySource = legacyCodex.config.integrations.find((s) => s.id === codex.id)
    legacySource.access = { mode: 'legacy' }
    legacySource.credential = { operation: 'keep' }
    legacySource.enabled = false
    legacyCodex.config.modules.find((m) => m.id === 'codex').fields = {
      ['/accounts/@' + expectedAccountId + '/state']: { enabled: false, visibility: 'admin' },
    }
    // Existing legacy data is imported internally, never created through the new admin form.
    assert.equal((await saveConfig(db, legacyCodex, { actor: { kind: 'system' } })).success, true)
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
    await prove(value, [codex.id])
    codex.identityCredential = { operation: 'import', value: importedIdentity }
    assert.equal((await save(value)).status, 200)
    const identity = (
      await db
        .prepare("SELECT identity_envelope_json FROM integrations WHERE id='codex-fixture'")
        .first()
    ).identity_envelope_json
    assert.ok(identity)
    await expect
      .poll(
        async () =>
          (
            await db
              .prepare(
                "SELECT count(*) n FROM integration_snapshot_views WHERE source_id='codex-fixture'",
              )
              .first()
          ).n,
      )
      .toBe(1)
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
    await prove(value, ['codex-fixture'])
    assert.equal((await save(value)).status, 200)
    assert.equal(
      (
        await db
          .prepare("SELECT identity_envelope_json FROM integrations WHERE id='codex-fixture'")
          .first()
      ).identity_envelope_json,
      identity,
    )
    await expect.poll(() => upstream.at(-1)?.authorization).toBe('Bearer Synthetic-replacement-key')
    assert.equal(JSON.parse((await codexSnapshot()).snapshot_json).data.accounts[0].id, accountId)
    const guest = await dash.fetch(origin + '/api/dashboard')
    assert.equal((await guest.json()).modules.find((m) => m.id === 'codex').kind, 'login_required')

    const refreshBeforeBrowser = (await input()).config.integrations.find(
      (i) => i.id === 'fixture',
    ).refreshInterval
    await db.prepare('DELETE FROM login_limits').run()
    await t.test(
      'provider-driven source manager, credential lifecycle and responsive dialogs',
      { skip: process.env.NOZOKI_TEST_BROWSER !== '1' },
      async () => {
        const { launch, settle } = await import('../browser/support.ts')
        const { exerciseSourceManager } = await import('../browser/source-manager.ts')
        await mf.ready
        browser = await launch()
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
        await context.addCookies([
          { name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: origin },
        ])
        const page = await context.newPage()
        await page.goto(origin + '/admin')
        await settle(page)
        await exerciseSourceManager(page, { input, save, deepId: deep.id, evidence, db })
        await context.close()
        await browser.close()
        browser = null
      },
    )
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
      process.env.NOZOKI_TEST_BROWSER === '1' ? 75 : refreshBeforeBrowser,
    )
    const beforeMismatch = upstream.length
    await mf.dispose()
    const changed = convertV4MiniflareOptions({
      ...common,
      bindings: { ...env, COLLECTOR_EPOCH: '2' },
      modules,
      modulesRoot: root,
    })
    changed.resourcePersistencePath = folder
    mf = new Miniflare(changed)
    dash = await mf.getWorker()
    assert.deepEqual(await (await request('/api/admin/source-connector')).json(), {
      configured: true,
      publicMode: 'worker',
      privateConfigured: false,
      environmentMatches: false,
    })
    const mismatched = await request('/api/admin/integrations/fixture/test', 'POST', {})
    assert.equal((await mismatched.json()).code, 'CONNECTOR_UNAVAILABLE')
    assert.equal(upstream.length, beforeMismatch)
  },
)
