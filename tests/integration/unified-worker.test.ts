import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { source, balance } from '../fixtures/adapters.ts'
import { tencentFixtures } from '../fixtures/tencent-quotes.ts'

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve('wrangler/package.json'),
)('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const root = resolve('.output/server')
async function walk(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? walk(resolve(directory, entry.name))
          : [resolve(directory, entry.name)],
      ),
    )
  ).flat()
}
const modules = (await walk(root))
  .filter((path) => path.endsWith('.mjs'))
  .sort((a, b) =>
    a === resolve(root, 'index.mjs')
      ? -1
      : b === resolve(root, 'index.mjs')
        ? 1
        : a.localeCompare(b),
  )
  .map((path) => ({ type: 'ESModule', path }))

test(
  'fresh single Worker: HTTP, default Cron, one encryption secret, automatic deployment fencing and restart',
  { timeout: 90000 },
  async (t) => {
    const folder = await mkdtemp(resolve('.wrangler/unified-worker-'))
    const origin = 'http://127.0.0.1:8897'
    const baseEnv = {
      AUTH_ORIGIN: origin,
      AUTH_ALLOW_LOCAL_HTTP: '1',
      AUTH_VERSION: '1',
      ADMIN_EMAIL: 'single@example.invalid',
      ADMIN_PASSWORD: 'Synthetic-' + randomToken(),
      AUTH_RATE_LIMIT_SECRET: randomToken(),
      INTEGRATION_KEY_VERSION: 'v1',
    }
    const oldEnv = {
      ...baseEnv,
      CF_VERSION_METADATA: { id: 'version-one', timestamp: '2026-11-05T00:00:00.000Z' },
    }
    const env = {
      ...baseEnv,
      INTEGRATION_ENCRYPTION_KEY: randomToken(),
      CF_VERSION_METADATA: { id: 'version-two', timestamp: '2026-11-05T00:01:00.000Z' },
    }
    const outgoing = []
    let quoteFailure = false
    function options(bindings, stale = false) {
      const common = {
        compatibilityDate: '2026-10-19',
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        modules,
        modulesRoot: root,
        d1Databases: { DB: 'unified-isolated' },
        outboundService: async (request) => {
          const url = new URL(request.url)
          assert.equal(request.method, 'GET')
          assert.equal(request.headers.get('cookie'), null)
          outgoing.push({ url: request.url, authorization: request.headers.get('authorization') })
          if (url.hostname === 'api.deepseek.com') {
            assert.equal(url.pathname, '/user/balance')
            assert.equal(request.headers.get('authorization'), 'Bearer synthetic-balance-key')
            return Response.json(balance)
          }
          assert.equal(url.hostname, 'web.ifzq.gtimg.cn')
          assert.equal(request.headers.get('authorization'), null)
          if (quoteFailure)
            return new Response(null, { status: 429, headers: { 'Retry-After': '3600' } })
          const symbol = url.searchParams.get('param').split(',')[0].slice(2)
          assert.ok(tencentFixtures[symbol])
          return new Response(JSON.stringify(tencentFixtures[symbol]), {
            headers: { 'Content-Type': 'text/html; charset=UTF-8' },
          })
        },
      }
      const options = convertV4MiniflareOptions({
        workers: [
          { ...common, name: 'application', bindings },
          ...(stale ? [{ ...common, name: 'old-deployment', bindings: oldEnv }] : []),
        ],
      })
      options.resourcePersistencePath = folder
      return options
    }
    let mf = new Miniflare(options(oldEnv))
    t.after(() => mf.dispose())
    let db = await mf.getD1Database('DB', 'application'),
      app = await mf.getWorker('application')
    for (const file of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    }
    let cookie = '',
      csrf = ''
    const request = (path, method = 'GET', body) =>
      app.fetch(origin + path, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== 'GET'
            ? {
                Origin: origin,
                'Content-Type': 'application/json',
                'X-Nozoki-CSRF': csrf,
                'Idempotency-Key': crypto.randomUUID(),
              }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    assert.equal((await request('/api/dashboard')).status, 200)
    assert.equal((await request('/')).status, 200)
    assert.equal(outgoing.length, 0)
    assert.equal(
      (await app.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })).outcome,
      'ok',
    )
    assert.equal(outgoing.length, 2)
    let guest = await (await request('/api/dashboard')).json()
    assert.deepEqual(
      guest.modules.find((m) => m.id === 'quotes').snapshot.data.items.map((q) => q.symbol),
      ['QQQM', 'VOO'],
    )
    assert.equal((await db.prepare('SELECT epoch FROM collector_environment').first()).epoch, 1)

    // Adding the one encryption Secret creates a new Worker version. No manual epoch is configured.
    await mf.setOptions(options(env))
    app = await mf.getWorker('application')
    db = await mf.getD1Database('DB', 'application')
    const login = await request('/api/auth/login', 'POST', {
      email: baseEnv.ADMIN_EMAIL,
      password: baseEnv.ADMIN_PASSWORD,
    })
    assert.equal(login.status, 200)
    cookie = login.headers.get('set-cookie').split(';')[0]
    csrf = (await (await request('/api/auth/csrf')).json()).token
    const config = await (await request('/api/admin/config')).json()
    const value = editableConfig(config)
    const s = createIntegrationDraft('deepseek', value.integrations, 'fixture')
    s.baseUrl = 'https://api.deepseek.com/'
    s.id = 'single-secret'
    s.enabled = true
    s.access.approvedTarget = sourceTargetKey(s, s.access)
    s.credential = { operation: 'replace', value: 'synthetic-balance-key' }
    const probe = await (
      await request('/api/admin/integrations/' + s.id + '/test', 'POST', {
        expectedVersion: config.site.configVersion,
        draft: s,
        quoteSymbols: [],
      })
    ).json()
    assert.ok(probe.connectionProof, JSON.stringify(probe))
    s.connectionProof = probe.connectionProof
    value.integrations.push(s)
    const module = value.modules.find((m) => m.id === 'deepseek')
    module.enabled = true
    module.visibility = 'admin'
    module.sources.main = { sourceId: s.id, subject: 'default' }
    const saved = await request('/api/admin/config', 'PUT', {
      expectedVersion: config.site.configVersion,
      config: value,
    })
    assert.equal(saved.status, 200, await saved.clone().text())
    assert.equal(
      (await (await request('/api/admin/integrations/single-secret/test', 'POST', {})).json())
        .protocolMatched,
      true,
    )
    assert.equal(
      (await app.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })).outcome,
      'ok',
    )
    const environment = await db.prepare('SELECT * FROM collector_environment').first()
    assert.equal(environment.epoch, 2)
    assert.equal(environment.deployment_id, 'version-two')
    const admin = await (await request('/api/dashboard')).json()
    assert.ok(
      JSON.stringify(admin.modules.find((m) => m.id === 'deepseek').snapshot.data).includes(
        '110.000000000000000001',
      ),
    )
    const stored = JSON.stringify(
      await db.prepare('SELECT * FROM integrations WHERE id=?').bind(s.id).first(),
    )
    assert.ok(!stored.includes('synthetic-balance-key'))
    assert.ok(!JSON.stringify(admin).includes('synthetic-balance-key'))
    guest = await (await app.fetch(origin + '/api/dashboard')).json()
    assert.equal(guest.modules.find((m) => m.id === 'deepseek').kind, 'login_required')
    const before = outgoing.length
    assert.equal((await app.fetch(origin + '/collect')).status, 404)
    assert.equal((await app.fetch(origin + '/cdn-cgi/handler/scheduled')).status, 404)
    assert.equal(outgoing.length, before)

    await mf.setOptions(options(env, true))
    const old = await mf.getWorker('old-deployment')
    assert.equal(
      (await old.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })).outcome,
      'exception',
    )
    assert.equal(outgoing.length, before)
    assert.equal(
      (
        await (
          await mf.getD1Database('DB', 'application')
        )
          .prepare('SELECT epoch FROM collector_environment')
          .first()
      ).epoch,
      2,
    )
    const env3 = {
      ...env,
      CF_VERSION_METADATA: { id: 'version-three', timestamp: '2026-11-05T00:02:00.000Z' },
    }
    quoteFailure = true
    await mf.setOptions(options(env3))
    app = await mf.getWorker('application')
    assert.equal(
      (await app.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })).outcome,
      'ok',
    )
    guest = await (await app.fetch(origin + '/api/dashboard')).json()
    const quotes = guest.modules.find((m) => m.id === 'quotes').snapshot
    assert.equal(quotes.data.items[0].price, '284.34')
    assert.equal(quotes.collection.errorCode, 'RATE_LIMITED')
    const afterCodeDeploy = outgoing.length
    await mf.dispose()
    mf = new Miniflare(options(env3))
    app = await mf.getWorker('application')
    assert.equal((await request('/api/admin/config')).status, 200)
    assert.equal(
      (await app.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })).outcome,
      'ok',
    )
    assert.equal(outgoing.length, afterCodeDeploy)
  },
)
