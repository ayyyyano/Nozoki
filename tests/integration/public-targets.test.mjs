import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { source, sleepMeta, sleepStatus } from '../fixtures/adapters.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')

test('native workerd/D1 public probe and collection, persistence and deployment fencing', async (t) => {
  await mkdir('.wrangler/public-route-tests', { recursive: true })
  const persist = await mkdtemp(resolve('.wrangler/public-route-tests/run-'))
  const s = { ...source('sleepy'), baseUrl: 'https://sleepy.example.com/service/' }
  const routes = JSON.stringify([
    {
      id: s.id,
      provider: s.provider,
      protocolVersion: s.protocolVersion,
      baseUrl: s.baseUrl,
      authentication: 'none',
    },
  ])
  const script = (
    await build({
      entryPoints: ['tests/integration/public-targets-worker.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:workers'],
    })
  ).outputFiles[0].text
  let calls = 0
  const options = convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-10-19',
    d1Databases: { DB: 'public-isolated' },
    bindings: {
      NOZOKI_PUBLIC_ROUTES: routes,
      COLLECTOR_EPOCH: '1',
      ADMIN_EMAIL: 'owner@example.invalid',
      ADMIN_PASSWORD: 'Synthetic-' + randomToken(),
      AUTH_VERSION: '1',
      AUTH_ORIGIN: 'https://dashboard.example.com',
      AUTH_RATE_LIMIT_SECRET: randomToken(),
    },
    outboundService: async (request) => {
      calls++
      assert.equal(request.method, 'GET')
      assert.equal(request.headers.get('cookie'), null)
      assert.equal(request.headers.get('authorization'), null)
      if (request.url === s.baseUrl + 'api/meta') return Response.json(sleepMeta)
      assert.equal(request.url, s.baseUrl + 'api/status/query')
      const value = structuredClone(sleepStatus)
      value.time = Date.now() / 1000
      value.last_updated = value.time
      return Response.json(value)
    },
  })
  options.resourcePersistencePath = persist
  let mf = new Miniflare(options)
  t.after(async () => mf.dispose())
  let db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  const current = await readConfig(db),
    config = editableConfig(current)
  const { credentialState: _, ...settings } = s
  config.modules.find((m) => m.id === 'quotes').sources = {}
  config.integrations = [{ ...settings, credential: { operation: 'keep' } }]
  config.modules.find((m) => m.id === 'devices').sources.main = {
    sourceId: s.id,
    subject: 'default',
  }
  assert.equal(
    (
      await saveConfig(
        db,
        { expectedVersion: current.site.configVersion, config },
        { actor: { kind: 'system' } },
      )
    ).success,
    true,
  )
  const version = (await readConfig(db)).site.configVersion
  const call = async (path, value) =>
    (
      await mf.dispatchFetch(
        'http://local.test/' + path,
        value
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(value),
            }
          : {},
      )
    ).json()
  const probe = await call('probe')
  assert.equal(probe.code, undefined, `public probe failed after ${calls} intercepted requests`)
  assert.equal(probe.authentication, 'not_required')
  assert.equal(probe.protocolMatched, true)
  assert.equal(calls, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_snapshots').first()).n, 0)
  assert.equal((await readConfig(db)).site.configVersion, version)
  const collected = await call('collect')
  assert.equal(collected.fatal, null)
  assert.equal(collected.success, 1)
  assert.equal(collected.requests, 1)
  assert.equal(calls, 2)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_snapshots').first()).n, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_snapshot_views').first()).n, 1)
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM collection_runs WHERE status='success'").first()).n,
    1,
  )
  assert.equal(await call('environment', { routes: '[]', epoch: 1 }), 'ENVIRONMENT_CHANGED')
  assert.equal(await call('environment', { routes: '[]', epoch: 2 }), 'ok')
  assert.equal((await call('collect')).fatal, 'COLLECTION_UNAVAILABLE')
  assert.equal(calls, 2)
  await mf.dispose()
  mf = new Miniflare(options)
  db = await mf.getD1Database('DB')
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_snapshot_views').first()).n, 1)
  assert.equal((await db.prepare('SELECT epoch FROM collector_environment').first()).epoch, 2)
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
})
