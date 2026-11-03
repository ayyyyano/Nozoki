import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { createUnconfiguredDashboard, snapshot } from '../../shared/domain/dashboard.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'

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
  .filter((p) => p.endsWith('.mjs'))
  .sort((a, b) =>
    a === resolve(root, 'index.mjs')
      ? -1
      : b === resolve(root, 'index.mjs')
        ? 1
        : a.localeCompare(b),
  )
  .map((path) => ({ type: 'ESModule', path }))

test(
  'native Worker serves an intact pending-migration database read-only, then recovers without restart',
  { timeout: 120000 },
  async () => {
    const origin = 'http://127.0.0.1:8799'
    let requests = 0
    const common = {
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'migration-readiness' },
      bindings: {
        AUTH_ORIGIN: origin,
        AUTH_ALLOW_LOCAL_HTTP: '1',
        AUTH_VERSION: '1',
        ADMIN_EMAIL: 'migration@example.invalid',
        ADMIN_PASSWORD: 'Synthetic-migration-password-only',
        AUTH_RATE_LIMIT_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
          'base64url',
        ),
        COLLECTOR_EPOCH: '1',
      },
      outboundService: () => {
        requests++
        return new Response(null, { status: 503 })
      },
    }
    const options = convertV4MiniflareOptions({
      workers: [
        { ...common, name: 'dashboard', modules, modulesRoot: root },
        {
          ...common,
          name: 'collector',
          modules: true,
          scriptPath: resolve('.output/collector/index.mjs'),
        },
      ],
    })
    options.resourcePersistencePath = await mkdtemp(resolve('.wrangler/migration-readiness-'))
    const mf = new Miniflare(options)
    try {
      const db = await mf.getD1Database('DB', 'dashboard')
      const dash = await mf.getWorker('dashboard')
      const json = async (path, init) => {
        const response = await dash.fetch(origin + path, init)
        return { response, data: await response.json() }
      }
      assert.equal((await json('/api/dashboard')).response.status, 503)
      assert.equal(
        await db.prepare("SELECT name FROM sqlite_master WHERE name='site_settings'").first(),
        null,
      )
      const files = (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()
      const apply = async (name) =>
        db.batch(
          unstable_splitSqlQuery(await readFile('migrations/' + name, 'utf8')).map((sql) =>
            db.prepare(sql),
          ),
        )
      for (const name of files.filter((f) => f < '0016')) await apply(name)
      const observed = new Date().toISOString()
      const quote = {
        ...createUnconfiguredDashboard().quotes.data.items[0],
        provider: 'tencent',
        price: '123.45',
        currency: 'USD',
      }
      await upsertSnapshot(db, {
        sourceId: 'tencent',
        subject: 'default',
        moduleId: 'quotes',
        updatedAt: observed,
        snapshot: {
          ...snapshot('ok', { items: [quote] }, 'tencent'),
          observedAt: observed,
          collectedAt: observed,
          lastSuccessAt: observed,
        },
      })
      const viewsBefore = (await db.prepare('SELECT * FROM integration_snapshot_views').all())
        .results
      await db
        .prepare(
          "UPDATE dashboard_modules SET title='Saved private device title' WHERE id='devices'",
        )
        .run()
      const storedBefore = (await db.prepare('SELECT * FROM dashboard_modules ORDER BY id').all())
        .results
      const config = await readConfig(db)
      assert.equal(config.modules.length, 8)
      assert.equal(config.modules.find((m) => m.id === 'tailscale').enabled, false)
      assert.equal((await readStoredState(db)).storageMode, 'read-only')
      const guest = await json('/api/dashboard')
      assert.equal(guest.response.status, 200)
      assert.equal(guest.data.viewer, 'guest')
      assert.ok(guest.data.modules.some((m) => m.id === 'links'))
      assert.ok(guest.data.modules.some((m) => m.id === 'activity'))
      assert.equal(
        guest.data.modules.find((m) => m.id === 'quotes').snapshot.data.items[0].price,
        '123.45',
      )
      assert.ok(
        !JSON.stringify(guest.data).includes('Saved private device title') ||
          guest.data.modules.find((m) => m.id === 'devices')?.kind === 'login_required',
      )
      const login = await json('/api/auth/login', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: common.bindings.ADMIN_EMAIL,
          password: common.bindings.ADMIN_PASSWORD,
        }),
      })
      assert.equal(login.response.status, 200)
      const cookie = login.response.headers.get('set-cookie').split(';')[0]
      const admin = await json('/api/admin/config', { headers: { Cookie: cookie } })
      assert.equal(admin.response.status, 200)
      assert.equal(admin.response.headers.get('X-Nozoki-Storage-Mode'), 'read-only')
      const html = await dash.fetch(origin + '/admin', { headers: { Cookie: cookie } })
      assert.equal(html.status, 200)
      assert.match(await html.text(), /数据库等待迁移/)
      const csrf = await json('/api/auth/csrf', { headers: { Cookie: cookie } })
      const draft = { expectedVersion: config.site.configVersion, config: editableConfig(config) }
      draft.config.site.siteName = 'Should not be saved before migration'
      const mutationHeaders = {
        Cookie: cookie,
        Origin: origin,
        'X-Nozoki-CSRF': csrf.data.token,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      }
      const denied = await json('/api/admin/config', {
        method: 'PUT',
        headers: mutationHeaders,
        body: JSON.stringify(draft),
      })
      assert.equal(denied.response.status, 503)
      assert.equal(denied.data.code, 'MIGRATIONS_REQUIRED')
      const probe = await json('/api/admin/integrations/tencent/test', {
        method: 'POST',
        headers: mutationHeaders,
      })
      assert.equal(probe.data.code, 'MIGRATIONS_REQUIRED')
      const unauthed = await json('/api/admin/config', {
        method: 'PUT',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      assert.equal(unauthed.response.status, 401)
      const invalidCsrf = await json('/api/admin/config', {
        method: 'PUT',
        headers: { ...mutationHeaders, 'X-Nozoki-CSRF': 'invalid' },
        body: JSON.stringify(draft),
      })
      assert.equal(invalidCsrf.response.status, 403)
      const logoutLogin = await json('/api/auth/login', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: common.bindings.ADMIN_EMAIL,
          password: common.bindings.ADMIN_PASSWORD,
        }),
      })
      const logoutCookie = logoutLogin.response.headers.get('set-cookie').split(';')[0]
      const logoutCsrf = await json('/api/auth/csrf', { headers: { Cookie: logoutCookie } })
      const loggedOut = await json('/api/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: logoutCookie,
          Origin: origin,
          'X-Nozoki-CSRF': logoutCsrf.data.token,
        },
      })
      assert.equal(loggedOut.response.status, 200)
      assert.equal(loggedOut.data.viewer, 'guest')
      assert.equal(
        (await saveConfig(db, draft, { actor: { kind: 'system' } })).code,
        'MIGRATIONS_REQUIRED',
      )
      const collector = await mf.getWorker('collector')
      const outcome = await collector.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })
      assert.equal(outcome.outcome, 'exception')
      assert.equal(requests, 0)
      assert.deepEqual(
        (await db.prepare('SELECT * FROM dashboard_modules ORDER BY id').all()).results,
        storedBefore,
      )
      assert.equal((await db.prepare('SELECT count(*) n FROM collection_state').first()).n, 0)
      assert.deepEqual(
        (await db.prepare('SELECT * FROM integration_snapshot_views').all()).results,
        viewsBefore,
      )
      await apply('0016_tailscale_module.sql')
      const recovered = await json('/api/admin/config', { headers: { Cookie: cookie } })
      assert.equal(recovered.response.headers.get('X-Nozoki-Storage-Mode'), 'ready')
      const staleDraft = await json('/api/admin/config', {
        method: 'PUT',
        headers: mutationHeaders,
        body: JSON.stringify(draft),
      })
      assert.equal(staleDraft.response.status, 409)
      assert.equal(staleDraft.data.code, 'CONFIG_CONFLICT')
      const current = editableConfig(recovered.data)
      current.site.siteName = 'Saved after migration'
      const saved = await json('/api/admin/config', {
        method: 'PUT',
        headers: { ...mutationHeaders, 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          expectedVersion: recovered.data.site.configVersion,
          config: current,
        }),
      })
      assert.equal(saved.response.status, 200)
      assert.equal(saved.data.success, true)
      assert.equal((await json('/api/dashboard')).data.site.siteName, 'Saved after migration')
      assert.equal(
        (await json('/api/dashboard')).data.modules.find((m) => m.id === 'quotes').snapshot.data
          .items[0].price,
        '123.45',
      )
      // A broken modern schema must not receive a manufactured replacement module.
      await db.prepare("DELETE FROM dashboard_modules WHERE id='tailscale'").run()
      assert.equal((await json('/api/dashboard')).response.status, 503)
    } finally {
      await mf.dispose()
    }
  },
)
