import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { source } from '../fixtures/adapters.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare'),
  { unstable_splitSqlQuery } = require('wrangler')
const fixture = JSON.parse(await readFile('tests/fixtures/yahoo-chart.json', 'utf8'))

test('Yahoo approved route, real workerd/D1 collection, ACL, failure retention, quote revision and restart', async (t) => {
  await mkdir('.wrangler/yahoo-tests', { recursive: true })
  const persist = await mkdtemp(resolve('.wrangler/yahoo-tests/run-'))
  const s = {
    ...source('quotes-custom'),
    id: 'yahoo',
    baseUrl: 'https://query1.finance.yahoo.com/',
  }
  const script = (
    await build({
      entryPoints: ['tests/integration/yahoo-chart-worker.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:workers'],
    })
  ).outputFiles[0].text
  let calls = 0,
    failure = false,
    block = false,
    entered,
    release
  const options = convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-10-19',
    d1Databases: { DB: 'yahoo-isolated' },
    bindings: {
      NOZOKI_PUBLIC_ROUTES: JSON.stringify([
        {
          id: s.id,
          provider: s.provider,
          protocolVersion: s.protocolVersion,
          baseUrl: s.baseUrl,
          authentication: 'none',
        },
      ]),
      COLLECTOR_EPOCH: '1',
      ADMIN_EMAIL: 'owner@example.invalid',
      ADMIN_PASSWORD: 'Synthetic-' + randomToken(),
      AUTH_VERSION: '1',
      AUTH_ORIGIN: 'https://dashboard.example.com',
      AUTH_RATE_LIMIT_SECRET: randomToken(),
    },
    outboundService: async (request) => {
      calls++
      const url = new URL(request.url)
      assert.equal(url.origin, 'https://query1.finance.yahoo.com')
      assert.equal(url.search, '?range=5d&interval=1d')
      assert.equal(request.method, 'GET')
      assert.equal(request.headers.get('authorization'), null)
      assert.equal(request.headers.get('cookie'), null)
      if (failure) return new Response('private upstream error', { status: 503 })
      if (block) {
        block = false
        entered()
        await new Promise((r) => (release = r))
      }
      const symbol = url.pathname.split('/').at(-1)
      assert.ok(['QQQM', 'VOO'].includes(symbol))
      return Response.json(fixture.responses[symbol])
    },
  })
  options.resourcePersistencePath = persist
  let mf = new Miniflare(options)
  t.after(async () => {
    release?.()
    await mf.dispose()
  })
  let db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations'))
    .filter((f) => f.endsWith('.sql') && f < '0012')
    .sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  const current = await readConfig(db),
    config = editableConfig(current),
    { credentialState: _, ...settings } = s
  config.integrations = [{ ...settings, credential: { operation: 'keep' } }]
  config.quotes.forEach((q) => (q.provider = s.id))
  const module = config.modules.find((m) => m.id === 'quotes')
  module.visibility = 'public'
  module.sources.main = { sourceId: s.id, subject: 'default' }
  module.fields[fieldPointer(['items', '*', 'volume'])] = {
    enabled: true,
    visibility: 'admin',
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
  const beforeUpgrade = await readConfig(db)
  const revisionBeforeUpgrade = await db
    .prepare('SELECT collection_revision FROM integrations WHERE id=?')
    .bind(s.id)
    .first()
  await db.batch(
    unstable_splitSqlQuery(
      await readFile('migrations/0012_quote_collection_revision.sql', 'utf8'),
    ).map((sql) => db.prepare(sql)),
  )
  assert.deepEqual(await readConfig(db), beforeUpgrade)
  assert.deepEqual(
    await db.prepare('SELECT collection_revision FROM integrations WHERE id=?').bind(s.id).first(),
    revisionBeforeUpgrade,
  )
  const call = async (path) => (await mf.dispatchFetch('http://local.test' + path)).json()
  const probe = await call('/probe')
  assert.equal(probe.protocolMatched, true)
  assert.equal(probe.authentication, 'not_required')
  assert.equal(calls, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM integration_snapshots').first()).n, 0)
  let report = await call('/collect')
  assert.equal(report.success, 1)
  assert.equal(report.requests, 2)
  assert.equal(calls, 3)
  const stored = await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first()
  const data = JSON.parse(stored.snapshot_json)
  assert.equal(data.data.items.length, 2)
  assert.equal(data.data.items[0].price, '284.34')
  assert.equal(data.data.items[0].history.length, 5)
  assert.equal(
    data.observedAt,
    new Date(fixture.responses.QQQM.chart.result[0].meta.regularMarketTime * 1000).toISOString(),
  )
  let dashboard = await call('/api/dashboard'),
    quotes = dashboard.modules.find((m) => m.id === 'quotes').snapshot.data.items
  assert.equal(quotes.length, 2)
  assert.equal(quotes[0].price, '284.34')
  assert.equal(quotes[1].volume, undefined)
  assert.equal(JSON.stringify(dashboard).includes('query1.finance.yahoo.com'), false)
  assert.equal(calls, 3, 'Dashboard reads must not request Yahoo')
  const due = () =>
    db
      .prepare(
        "UPDATE collection_state SET next_run_at='1970-01-01T00:00:00.000Z',last_scheduled_at=NULL",
      )
      .run()
  failure = true
  await due()
  report = await call('/collect')
  assert.equal(report.failure, 1)
  assert.equal(
    (await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first())
      .snapshot_json,
    stored.snapshot_json,
  )
  failure = false
  await due()
  block = true
  const ready = new Promise((r) => (entered = r)),
    pending = call('/collect')
  await ready
  const before = await db
    .prepare('SELECT collection_revision FROM integrations WHERE id=?')
    .bind(s.id)
    .first()
  await db.prepare("UPDATE quote_symbols SET enabled=0 WHERE symbol='VOO'").run()
  assert.ok(
    (await db.prepare('SELECT collection_revision FROM integrations WHERE id=?').bind(s.id).first())
      .collection_revision > before.collection_revision,
  )
  release()
  report = await pending
  assert.equal(report.failure, 1)
  assert.equal(
    (await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first())
      .snapshot_json,
    stored.snapshot_json,
  )
  assert.equal(
    (
      await db
        .prepare('SELECT error_code FROM collection_runs ORDER BY started_at DESC LIMIT 1')
        .first()
    ).error_code,
    'SOURCE_CHANGED',
  )
  dashboard = await call('/api/dashboard')
  quotes = dashboard.modules.find((m) => m.id === 'quotes').snapshot.data.items
  assert.equal(quotes.length, 1)
  assert.equal(quotes[0].symbol, 'QQQM')
  await mf.dispose()
  mf = new Miniflare(options)
  db = await mf.getD1Database('DB')
  assert.equal(
    (await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first())
      .snapshot_json,
    stored.snapshot_json,
  )
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
})
