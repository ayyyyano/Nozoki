import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { source, balance } from '../fixtures/adapters.ts'
import { sleepyDevicesFixture } from '../fixtures/devices0511.ts'
import { createPrivateRelay, privateRoute } from '../../server/adapters/private-relay.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { importCredentialKey, encryptCredential } from '../../server/services/credentials.ts'
import { readBalanceChanges } from '../../server/services/balance-observations.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { cleanupCollection } from '../../server/repositories/collection.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler'),
  evidence = process.env.NOZOKI_TEST_EVIDENCE ?? '.wrangler/test-results/phase-06'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase06-tests', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase06-tests/run-')),
  harness = await build({
    entryPoints: ['tests/integration/collector-harness.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    external: ['cloudflare:workers'],
  })
const root = resolve('.output/server'),
  origin = 'http://127.0.0.1:8794'
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
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
const s = { ...source('sleepy'), baseUrl: 'https://source.example.com/service/' },
  relayToken = randomToken(),
  rootBytes = crypto.getRandomValues(new Uint8Array(32)),
  encryption = Buffer.from(rootBytes).toString('base64url'),
  keys = await importCredentialKey('v1', rootBytes)
const env = {
  COLLECTOR_EPOCH: '1',
  COLLECTOR_BINDING_REVISION: 'isolated-fixed-test-service',
  NOZOKI_PRIVATE_RELAY_TOKEN: relayToken,
  NOZOKI_PRIVATE_ROUTES: JSON.stringify([privateRoute(s)]),
  INTEGRATION_ENCRYPTION_KEY: encryption,
  INTEGRATION_KEY_VERSION: 'v1',
  ADMIN_EMAIL: 'owner@example.invalid',
  ADMIN_PASSWORD: 'SYNTHETIC-' + randomToken(),
  AUTH_RATE_LIMIT_SECRET: randomToken(),
  AUTH_VERSION: '1',
  AUTH_ORIGIN: origin,
  AUTH_ALLOW_LOCAL_HTTP: '1',
}
let upstream = 0,
  hostnames = 0,
  relayFailure = false,
  browser
const relay = await createPrivateRelay([{ source: s }], relayToken, async () => {
  upstream++
  if (relayFailure) return new Response('SYNTHETIC-ERROR', { status: 503 })
  const v = sleepyDevicesFixture()
  v.time = Date.now() / 1000
  v.last_updated = v.time
  return Response.json(v)
})
const binding = async (req) =>
  relay(new Request(req.url, { method: req.method, headers: req.headers }))
const dbid = '00000000-0000-0000-0000-000000000002'
function options() {
  const common = {
    compatibilityDate: '2026-10-19',
    compatibilityFlags: ['nodejs_compat'],
    bindings: env,
    d1Databases: { DB: dbid },
    serviceBindings: { NOZOKI_PRIVATE_RELAY: binding },
    outboundService: async (request) => {
      if (new URL(request.url).hostname === 'api.deepseek.com') {
        hostnames++
        return Response.json(balance)
      }
      assert.equal(new URL(request.url).origin, 'https://source.example.com')
      upstream++
      if (relayFailure) return new Response('SYNTHETIC-ERROR', { status: 503 })
      const v = sleepyDevicesFixture()
      v.time = Date.now() / 1000
      v.last_updated = v.time
      return Response.json(v)
    },
  }
  const c = convertV4MiniflareOptions({
    port: 8794,
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
      ...['collector-a', 'collector-b'].map((name) => ({
        ...common,
        name,
        modules,
        modulesRoot: root,
      })),
      {
        ...common,
        name: 'collector-unbound',
        modules,
        modulesRoot: root,
        bindings: { ...env, COLLECTOR_EPOCH: '2', NOZOKI_PRIVATE_ROUTES: '[]' },
        serviceBindings: {},
      },
      ...['h1', 'h2'].map((name) => ({
        ...common,
        name,
        modules: true,
        script: harness.outputFiles[0].text,
      })),
    ],
  })
  c.resourcePersistencePath = persist
  return c
}
let mf = new Miniflare(options()),
  db,
  h1,
  h2,
  ca,
  cb
const report = {
  runtime:
    'actual two Collector workerd isolates + Nuxt Modules Worker + shared isolated D1; Fetcher/HTTP fixtures only',
  persist,
  dbid,
  checks: [],
  concurrency: null,
  metrics: [],
}
const iso = (n) => new Date(n).toISOString(),
  at = Date.now() + 1000
const rows = async (table) =>
  (await db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).results
const save = async (change) => {
  const current = await readConfig(db),
    config = editableConfig(current)
  change(config)
  for (const source of config.integrations)
    if (source.access?.mode === 'public' && source.access.approved)
      source.access.approvedTarget = sourceTargetKey(source, source.access)
  const result = await saveConfig(
    db,
    { expectedVersion: current.site.configVersion, config },
    { actor: { kind: 'system' }, keys },
  )
  assert.equal(result.success, true, JSON.stringify(result))
  return result
}
async function reset(spec = [['fixture', 'sleepy', 'devices']]) {
  await db.batch(
    [
      'balance_observations',
      'collection_runs',
      'collection_state',
      'integration_snapshot_views',
      'integration_snapshots',
    ].map((t) => db.prepare('DELETE FROM ' + t)),
  )
  await save((c) => {
    c.integrations = spec.map(([id, provider]) => {
      const { credentialState: _, ...settings } = source(provider)
      const value = {
        ...settings,
        id,
        baseUrl:
          provider === 'sleepy'
            ? s.baseUrl
            : provider === 'deepseek'
              ? 'https://api.deepseek.com/'
              : settings.baseUrl,
        credential: { operation: 'keep' },
      }
      if (provider !== 'quotes-custom') {
        value.access = {
          mode: 'public',
          authentication: provider === 'deepseek' ? 'bearer' : 'none',
          approved: true,
          approvedTarget: null,
        }
        value.access.approvedTarget = sourceTargetKey(value, value.access)
      }
      return value
    })
    for (const m of c.modules) {
      m.sources = {}
      m.fields = {}
    }
    for (const [id, _provider, moduleId] of spec) {
      const module = c.modules.find((m) => m.id === moduleId)
      module.enabled = true
      module.sources.main = { sourceId: id, subject: 'default' }
    }
  })
}
test('phase 06 real workerd/D1 collector fences, schedules and shared reads', async (t) => {
  t.after(async () => {
    await browser?.close()
    await mf.dispose()
    await writeFile(
      evidence + '/collector.json',
      JSON.stringify({ ...report, upstream, hostnames }, null, 2),
    )
  })
  const check = (name, fn) =>
    t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  await mf.ready
  db = await mf.getD1Database('DB', 'dashboard')
  h1 = await mf.getWorker('h1')
  h2 = await mf.getWorker('h2')
  ca = await mf.getWorker('collector-a')
  cb = await mf.getWorker('collector-b')
  await check(
    'forward migration keeps a populated v9 configuration, ciphertext, snapshots and run IDs',
    async () => {
      const files = (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()
      for (const f of files.filter((f) => f < '0010_collection.sql'))
        await db.batch(
          unstable_splitSqlQuery(await readFile('migrations/' + f, 'utf8')).map((sql) =>
            db.prepare(sql),
          ),
        )
      const credential = await encryptCredential(
        s.id,
        s.provider,
        'SYNTHETIC-LEGACY-KEY',
        keys,
        iso(at),
      )
      await db
        .prepare(
          'INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json,credential_ciphertext,credential_iv,credential_key_version,credential_algorithm,credential_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          s.id,
          s.provider,
          s.protocolVersion,
          s.baseUrl,
          Number(s.enabled),
          s.refreshInterval,
          JSON.stringify(s.fieldMappings),
          JSON.stringify(s.capabilities),
          credential.ciphertext,
          credential.iv,
          credential.keyVersion,
          credential.algorithm,
          credential.updatedAt,
        )
        .run()
      await db
        .prepare(
          "INSERT INTO collection_runs(id,source_id,config_version,status,started_at,finished_at) VALUES('legacy',?,1,'success',?,?)",
        )
        .bind(s.id, iso(at), iso(at))
        .run()
      await upsertSnapshot(db, {
        sourceId: s.id,
        subject: 'legacy',
        moduleId: 'devices',
        snapshot: {
          status: 'ok',
          sourceId: s.id,
          data: { devices: [] },
          observedAt: null,
          collectedAt: iso(at),
          lastSuccessAt: iso(at),
          expiresAt: null,
        },
        updatedAt: iso(at),
      })
      const oldViews = await rows('integration_snapshot_views')
      const before = await rows('integrations'),
        run = await rows('collection_runs'),
        audit = await rows('integration_audit')
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/0010_collection.sql', 'utf8')).map(
          (sql) => db.prepare(sql),
        ),
      )
      const after = await rows('integrations')
      for (const key of Object.keys(before[0])) assert.equal(after[0][key], before[0][key])
      for (const key of Object.keys(run[0]))
        assert.equal((await rows('collection_runs'))[0][key], run[0][key])
      assert.deepEqual(await rows('integration_audit'), audit)
      assert.equal(after[0].collection_generation.length, 32)
      for (const key of Object.keys(oldViews[0]))
        assert.equal((await rows('integration_snapshot_views'))[0][key], oldViews[0][key])
      for (const f of files.filter((f) => f > '0010_collection.sql'))
        await db.batch(
          unstable_splitSqlQuery(await readFile('migrations/' + f, 'utf8')).map((sql) =>
            db.prepare(sql),
          ),
        )
      await reset()
    },
  )
  await check(
    'two independent workerd isolates race one atomic lease; duplicate scheduled time cannot claim twice',
    async () => {
      const claims = await Promise.all([h1.acquire(at, 'fixture'), h2.acquire(at, 'fixture')])
      assert.equal(claims.filter((v) => v && v !== 'null').length, 1)
      const claim = claims.find((v) => v && v !== 'null')
      report.concurrency = { claimWinners: 1, running: (await rows('collection_runs')).length }
      assert.equal(await h1.finish(claim, at + 1), 'success')
      assert.ok(!(await h2.acquire(at, 'fixture')))
      assert.equal((await rows('collection_runs')).length, 1)
    },
  )
  await check(
    'expired lease takeover rejects the original owner and completion cannot replay',
    async () => {
      await reset()
      const old = await h1.acquire(at, 'fixture'),
        fresh = await h2.acquire(at + 61000, 'fixture')
      assert.ok(fresh)
      assert.equal(await h2.finish(fresh, at + 61001), 'success')
      const before = await rows('integration_snapshot_views')
      assert.equal(await h1.finish(old, at + 61002), 'LEASE_LOST')
      assert.equal(await h2.finish(fresh, at + 61003), 'LEASE_LOST')
      assert.deepEqual(await rows('integration_snapshot_views'), before)
    },
  )
  await check(
    'source target, credentials, protocol, references, disabling and delete/recreate all fence old results',
    async () => {
      const mutations = [
        (c) => {
          c.integrations[0].baseUrl = 'https://another.example.com/root/'
          c.integrations[0].credential = { operation: 'clear' }
        },
        (c) => {
          c.integrations[0].credential = { operation: 'replace', value: 'SYNTHETIC-NEW-KEY' }
        },
        (c) => {
          c.integrations[0].protocolVersion = 'unknown-version'
        },
        (c) => {
          c.modules.find((m) => m.id === 'devices').sources.main.subject = 'changed'
        },
        (c) => {
          c.integrations[0].enabled = false
        },
      ]
      for (const mutate of mutations) {
        await reset()
        const claim = await h1.acquire(at, 'fixture')
        await save(mutate)
        assert.equal(await h1.finish(claim, at + 1), 'SOURCE_CHANGED')
        assert.equal((await rows('integration_snapshot_views')).length, 0)
      }
      await reset()
      const old = await h1.acquire(at, 'fixture')
      await save((c) => {
        c.integrations = []
        for (const m of c.modules) m.sources = {}
      })
      await reset()
      assert.equal(await h1.finish(old, at + 1), 'SOURCE_CHANGED')
    },
  )
  await check(
    'site title and theme edits do not discard an otherwise valid source result',
    async () => {
      await reset()
      const claim = await h1.acquire(at, 'fixture')
      await save((c) => {
        c.site.siteName = 'Unrelated theme'
        c.site.appearance.sourceColor = '#006A60'
      })
      assert.equal(await h1.finish(claim, at + 1), 'success')
    },
  )
  await check(
    'an older observation cannot overwrite newer data, even after another lease',
    async () => {
      await reset()
      const first = await h1.acquire(at, 'fixture')
      assert.equal(await h1.finish(first, at + 1), 'success')
      const before = await rows('integration_snapshot_views'),
        next = await h2.acquire(at + 301000, 'fixture')
      assert.ok(next)
      assert.equal(await h2.finish(next, at + 301001, iso(at - 1000)), 'RESULT_OLDER')
      assert.deepEqual(await rows('integration_snapshot_views'), before)
    },
  )
  await check(
    'view SQL failure rolls back parent and success state; retry commits the view and parent together',
    async () => {
      await reset()
      await db
        .prepare(
          "CREATE TRIGGER injected_view BEFORE INSERT ON integration_snapshot_views BEGIN SELECT RAISE(ABORT,'INJECTED_SQL_FAILURE'); END",
        )
        .run()
      let result = JSON.parse(await h1.run(at))
      assert.equal(result.failure, 1)
      assert.equal((await rows('integration_snapshots')).length, 0)
      assert.equal((await rows('integration_snapshot_views')).length, 0)
      assert.ok((await rows('collection_runs')).every((r) => r.status === 'failure'))
      assert.equal((await rows('collection_commit_guard')).length, 0)
      await db.prepare('DROP TRIGGER injected_view').run()
      result = JSON.parse(await h1.run(at + 601000))
      assert.equal(result.success, 1)
      assert.equal((await rows('integration_snapshots')).length, 1)
      assert.equal((await rows('integration_snapshot_views')).length, 1)
      await save((c) => {
        c.modules.find((m) => m.id === 'devices').enabled = false
      })
      const before = await rows('integration_snapshot_views')
      result = JSON.parse(await h1.run(at + 902000))
      assert.equal(result.selected, 0)
      assert.deepEqual(await rows('integration_snapshot_views'), before)
      await save((c) => {
        c.modules.find((m) => m.id === 'devices').enabled = true
      })
    },
  )
  await check(
    '401 preserves successful data, 429 enforces vendor cooldown through configuration edits, other sources still succeed',
    async () => {
      await reset()
      assert.equal(JSON.parse(await h1.run(at)).success, 1)
      const before = await rows('integration_snapshot_views')
      assert.equal(JSON.parse(await h1.run(at + 301000, 'auth')).failure, 1)
      assert.deepEqual(await rows('integration_snapshot_views'), before)
      assert.equal((await rows('collection_state'))[0].status, 'error')
      await reset()
      let r = JSON.parse(await h1.run(at, 'rate'))
      assert.equal(r.failure, 1)
      const until = (await rows('collection_state'))[0].retry_after_until
      await save((c) => {
        c.integrations[0].refreshInterval = 61
      })
      r = JSON.parse(await h1.run(at + 301000))
      assert.equal(r.selected, 0)
      assert.equal((await rows('collection_state'))[0].retry_after_until, until)
      await reset([
        ['a-source', 'sleepy', 'devices'],
        ['b-source', 'deepseek', 'deepseek'],
      ])
      r = JSON.parse(await h1.run(at, 'fail-one'))
      assert.equal(r.failure, 1)
      assert.equal(r.success, 1)
      assert.ok(r.selected <= 2)
      report.metrics.push(r)
    },
  )
  await check(
    'deployment epoch fences old tasks, root changes require a new epoch and epochs cannot roll back',
    async () => {
      await reset()
      const claim = await h1.acquire(at, 'fixture')
      const original = (await rows('collector_environment'))[0]
      await db
        .prepare('UPDATE collector_environment SET epoch=2,fingerprint=? WHERE id=1')
        .bind('a'.repeat(64))
        .run()
      try {
        assert.equal(await h1.finish(claim, at + 1), 'ENVIRONMENT_CHANGED')
        let denied = false
        try {
          await h1.acquire(at + 2, 'fixture')
        } catch (error) {
          denied = String(error).includes('ENVIRONMENT_CHANGED')
        }
        assert.ok(denied, 'An older deployment must fail closed')
      } finally {
        await db
          .prepare('UPDATE collector_environment SET epoch=?,fingerprint=? WHERE id=1')
          .bind(original.epoch, original.fingerprint)
          .run()
      }
    },
  )
  await check('source timeout retains valid data and later scheduled work recovers', async () => {
    await reset()
    assert.equal(JSON.parse(await h1.run(at)).success, 1)
    const before = await rows('integration_snapshot_views')
    const failed = JSON.parse(await h1.run(at + 301000, 'hang'))
    assert.equal(failed.failure, 1)
    assert.equal((await rows('collection_runs')).at(-1).error_code, 'TIMEOUT')
    assert.deepEqual(await rows('integration_snapshot_views'), before)
    assert.equal(JSON.parse(await h1.run(at + 1000000)).success, 1)
  })
  await check(
    'balance history is exact, starts without fabricated changes, never writes official daily usage',
    async () => {
      await reset([['balance-source', 'deepseek', 'deepseek']])
      assert.equal(JSON.parse(await h1.run(at)).success, 1)
      let observations = await rows('balance_observations')
      assert.equal(observations.length, 2)
      const series = observations[0].series_revision
      let changes = await readBalanceChanges(db, 'balance-source', series, 60)
      assert.ok(changes.every((r) => r.change === null && r.observedAt === null))
      assert.equal(JSON.parse(await h1.run(at + 301000, 'changed-balance')).success, 1)
      observations = await rows('balance_observations')
      assert.equal(observations.length, 4)
      changes = await readBalanceChanges(db, 'balance-source', series, 60)
      assert.equal(changes.find((r) => r.change && r.point.currency === 'CNY').change.net, '-1')
      assert.equal(
        changes.find((r) => r.change && r.point.currency === 'CNY').change.officialSpend,
        null,
      )
      assert.equal((await rows('daily_usage')).length, 0)
      const removal = await saveConfig(
        db,
        {
          expectedVersion: (await readConfig(db)).site.configVersion,
          config: {
            ...editableConfig(await readConfig(db)),
            integrations: [],
            modules: (await readConfig(db)).modules.map((m) => ({ ...m, sources: {} })),
          },
        },
        { actor: { kind: 'system' } },
      )
      assert.equal(removal.code, 'VALIDATION_ERROR')
    },
  )
  await check(
    'disabled sources and modules do not collect; unapproved quote sources never create a price',
    async () => {
      await reset()
      await save((c) => {
        c.modules.find((m) => m.id === 'devices').enabled = false
      })
      assert.equal(JSON.parse(await h1.run(at)).selected, 0)
      await reset()
      await save((c) => {
        c.integrations[0].enabled = false
      })
      assert.equal(JSON.parse(await h1.run(at)).selected, 0)
      await reset([['quote-source', 'quotes-custom', 'quotes']])
      const n = upstream
      await ca.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })
      assert.equal(upstream, n)
      assert.equal((await rows('collection_state')).length, 1)
      assert.equal((await rows('collection_state'))[0].error_code, 'ACCESS_NOT_APPROVED')
      assert.equal((await rows('integration_snapshot_views')).length, 0)
    },
  )
  await check(
    'actual scheduled handler uses the approved public route once; not-due/duplicate and guest reads make zero additional requests',
    async () => {
      await reset()
      const before = upstream
      const scheduledAt = Date.now()
      const scheduled = await Promise.all([
        ca.scheduled({ scheduledTime: scheduledAt, cron: '*/5 * * * *' }),
        cb.scheduled({ scheduledTime: scheduledAt, cron: '*/5 * * * *' }),
      ])
      assert.ok(scheduled.every((r) => r.outcome === 'ok'))
      report.scheduledOutcomes = scheduled
      assert.equal(upstream, before + 1)
      await cb.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })
      assert.equal(upstream, before + 1)
      const dash = await mf.getWorker('dashboard')
      for (let i = 0; i < 3; i++) await dash.fetch(origin + '/api/dashboard')
      assert.equal(upstream, before + 1)
      assert.equal(hostnames, 0)
      assert.equal((await rows('collection_runs'))[0].status, 'success')
      assert.equal((await ca.fetch(origin + '/collect')).status, 404)
    },
  )
  await check(
    'production credential decryption reads only the fixed DeepSeek route and persists exact observations',
    async () => {
      await reset([['balance-source', 'deepseek', 'deepseek']])
      await save((c) => {
        c.integrations[0].baseUrl = 'https://api.deepseek.com/'
        c.integrations[0].credential = {
          operation: 'replace',
          value: 'SYNTHETIC-COLLECTOR-API-KEY',
        }
      })
      const count = hostnames
      const outcome = await ca.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })
      assert.equal(outcome.outcome, 'ok')
      assert.equal((await rows('collection_runs'))[0].status, 'success')
      assert.equal(hostnames, count + 1)
      const view = (await rows('integration_snapshot_views'))[0],
        data = JSON.parse(view.snapshot_json)
      assert.equal(data.observedAt, null)
      assert.equal(data.data.balances[0].total, '110.000000000000000001')
      assert.equal(Object.hasOwn(data.data, 'spend'), false)
      assert.equal((await rows('balance_observations')).length, 2)
      assert.equal((await rows('daily_usage')).length, 0)
    },
  )
  await check(
    'cleanup is bounded and does not remove active leases, latest snapshots or exact usage history',
    async () => {
      await reset()
      assert.equal(JSON.parse(await h1.run(at)).success, 1)
      const before = await rows('integration_snapshot_views')
      const claim = await h1.acquire(at + 301000, 'fixture')
      assert.ok(claim)
      const old = '2020-01-01T00:00:00.000Z'
      await db
        .prepare('UPDATE collection_runs SET started_at=? WHERE id=?')
        .bind(old, JSON.parse(claim).runId)
        .run()
      await db
        .prepare(
          `INSERT INTO collection_runs(id,source_id,config_version,status,started_at,finished_at) SELECT 'old-'||value,'fixture',1,'failure',?,? FROM json_each(?)`,
        )
        .bind(old, old, JSON.stringify(Array.from({ length: 150 }, (_, i) => i)))
        .run()
      await db
        .prepare(
          "UPDATE collector_environment SET cleanup_after='1970-01-01T00:00:00.000Z' WHERE id=1",
        )
        .run()
      await cleanupCollection(db, iso(at + 301001))
      assert.equal(
        (await rows('collection_runs')).filter((r) => r.id.startsWith('old-')).length,
        50,
      )
      assert.equal(
        (await rows('collection_runs')).find((r) => r.id === JSON.parse(claim).runId).status,
        'running',
      )
      assert.deepEqual(await rows('integration_snapshot_views'), before)
      const once = (await rows('collection_runs')).length
      assert.equal(await cleanupCollection(db, iso(at + 301002)), false)
      assert.equal((await rows('collection_runs')).length, once)
    },
  )
  await check(
    'browser guest/admin reads shared stored snapshots; collection failure preserves data and expired quota is not shown as current',
    async () => {
      await reset()
      await save((c) => {
        c.site.siteName = 'Collector offline fixtures'
        const m = c.modules.find((m) => m.id === 'devices')
        m.title = '设备 · 离线采集夹具'
        m.visibility = 'public'
        m.fields = {
          [fieldPointer(['devices', '@private.a/~'])]: { enabled: true, visibility: 'admin' },
          '/devices/@laptop/stateText': { enabled: true, visibility: 'admin' },
        }
      })
      await ca.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })
      const before = await rows('integration_snapshot_views')
      relayFailure = true
      await db
        .prepare(
          "UPDATE collection_state SET next_run_at='1970-01-01T00:00:00.000Z',last_scheduled_at=NULL WHERE source_id='fixture'",
        )
        .run()
      await ca.scheduled({ scheduledTime: Date.now() + 1, cron: '*/5 * * * *' })
      relayFailure = false
      assert.deepEqual(await rows('integration_snapshot_views'), before)
      const dash = await mf.getWorker('dashboard'),
        guest = await (await dash.fetch(origin + '/api/dashboard')).json(),
        deviceModule = guest.modules.find((m) => m.id === 'devices')
      assert.equal(deviceModule.snapshot.status, 'error')
      assert.ok(deviceModule.snapshot.data.devices.length > 0)
      assert.equal(deviceModule.snapshot.collection.errorCode, 'UPSTREAM_UNAVAILABLE')
      const csrfLogin = await dash.fetch(origin + '/api/auth/login', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
      })
      assert.equal(csrfLogin.status, 200)
      const cookie = csrfLogin.headers.get('set-cookie').split(';')[0]
      const admin = await (
        await dash.fetch(origin + '/api/dashboard', { headers: { Cookie: cookie } })
      ).json()
      assert.equal(admin.viewer, 'admin')
      assert.ok(JSON.stringify(admin).includes('PRIVATE-APPLICATION-0511'))
      assert.ok(!JSON.stringify(guest).includes('PRIVATE-APPLICATION-0511'))
      const cpa = {
        ...source('cliproxy-bridge'),
        id: 'codex-fixture',
        protocolVersion: 'cliproxy-v8-accounts',
      }
      await save((c) => {
        const { credentialState: _, ...settings } = cpa
        c.integrations.push({ ...settings, credential: { operation: 'keep' } })
        c.modules.find((m) => m.id === 'codex').sources.main = {
          sourceId: cpa.id,
          subject: 'default',
        }
      })
      const timestamp = new Date().toISOString()
      await upsertSnapshot(db, {
        sourceId: cpa.id,
        subject: 'default',
        moduleId: 'codex',
        updatedAt: timestamp,
        snapshot: {
          status: 'ok',
          sourceId: cpa.id,
          observedAt: timestamp,
          collectedAt: timestamp,
          lastSuccessAt: timestamp,
          expiresAt: null,
          data: {
            accounts: [],
            usage: null,
            estimatedCost: null,
            quota: {
              accounts: [
                {
                  id: 'safe-account',
                  windows: [
                    {
                      id: 'primary',
                      label: '过期测试窗口',
                      remainingPercent: '74.875',
                      resetAt: '2020-01-01T00:00:00.000Z',
                      status: 'ok',
                      basis: 'passive_headers',
                      observedAt: timestamp,
                    },
                  ],
                },
              ],
            },
            capabilities: {
              usage: { supported: false, verified: false },
              quota: { supported: true, verified: true },
              estimatedCost: { supported: false, verified: false },
            },
          },
        },
      })
      if (process.env.NOZOKI_TEST_BROWSER !== '1') return
      const { launch, settle } = await import('../browser/support.mjs')
      browser = await launch()
      const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          colorScheme: 'light',
        }),
        page = await context.newPage(),
        errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      const outBefore = { upstream, hostnames }
      await page.goto(origin)
      await settle(page)
      const devices = page.locator('[data-module="devices"]')
      await devices.getByText('采集失败', { exact: true }).waitFor()
      assert.equal(
        await devices.locator('[data-device-id="desktop"] .device-meter-neutral').count(),
        1,
      )
      assert.ok(!(await page.content()).includes('PRIVATE-APPLICATION-0511'))
      const ssr = await (await dash.fetch(origin)).text()
      assert.ok(!ssr.includes('PRIVATE-APPLICATION-0511'))
      await page.screenshot({
        path: evidence + '/collector-guest-desktop.png',
        fullPage: true,
        animations: 'disabled',
      })
      await page.setViewportSize({ width: 390, height: 844 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({
        path: evidence + '/collector-guest-mobile.png',
        fullPage: true,
        animations: 'disabled',
      })
      await context.addCookies([
        {
          name: 'nozoki_dev_session',
          value: cookie.split('=')[1],
          url: origin,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ])
      await page.reload()
      await settle(page)
      await page.locator('[data-module="codex"]').getByText('观测已过期', { exact: true }).waitFor()
      assert.ok(!(await page.locator('[data-module="codex"]').innerText()).includes('74.875'))
      assert.ok(
        (await page.locator('[data-module="devices"]').innerText()).includes(
          'PRIVATE-APPLICATION-0511',
        ),
      )
      await page.screenshot({
        path: evidence + '/collector-admin-mobile.png',
        fullPage: true,
        animations: 'disabled',
      })
      assert.deepEqual({ upstream, hostnames }, outBefore)
      assert.deepEqual(errors, [])
      await context.close()
      await browser.close()
      browser = undefined
      report.browser = {
        guestPrivateMarkers: false,
        adminPrivateMarkers: true,
        expiredPercentageHidden: true,
        refreshOutboundDelta: 0,
      }
    },
  )
  await check('both Workers read the same durable D1 after runtime restart', async () => {
    const before = {
      state: await rows('collection_state'),
      views: await rows('integration_snapshot_views'),
      runs: await rows('collection_runs'),
    }
    await mf.dispose()
    mf = new Miniflare(options())
    await mf.ready
    db = await mf.getD1Database('DB', 'dashboard')
    ca = await mf.getWorker('collector-a')
    cb = await mf.getWorker('collector-b')
    h1 = await mf.getWorker('h1')
    h2 = await mf.getWorker('h2')
    assert.deepEqual(
      {
        state: await rows('collection_state'),
        views: await rows('integration_snapshot_views'),
        runs: await rows('collection_runs'),
      },
      before,
    )
    const fromOther = await mf.getD1Database('DB', 'collector-b')
    assert.equal(
      (await fromOther.prepare('SELECT count(*) n FROM collection_state').first()).n,
      before.state.length,
    )
    report.sharedStorage = {
      id: dbid,
      persist,
      readAcrossRestart: true,
      collectorToDashboard: true,
    }
  })
  await check(
    'unapproved target and absent private bindings make no external request; old environment cannot regain authority',
    async () => {
      await reset()
      await save((c) => {
        c.integrations[0].baseUrl = 'https://unapproved.invalid/'
        c.integrations[0].access = { mode: 'legacy' }
        c.integrations[0].credential = { operation: 'clear' }
      })
      let before = { upstream, hostnames }
      await ca.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })
      assert.deepEqual({ upstream, hostnames }, before)
      assert.equal((await rows('collection_state'))[0].error_code, 'ACCESS_NOT_APPROVED')
      await reset()
      await save((c) => {
        c.integrations[0].access = { mode: 'legacy' }
      })
      const unbound = await mf.getWorker('collector-unbound')
      before = { upstream, hostnames }
      await unbound.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' })
      assert.deepEqual({ upstream, hostnames }, before)
      assert.equal((await rows('collection_state'))[0].error_code, 'ACCESS_NOT_APPROVED')
      const rejected = JSON.parse(await h1.run(Date.now()))
      assert.equal(rejected.fatal, 'COLLECTION_UNAVAILABLE')
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    },
  )
  await check(
    'a damaged collector schema cannot silently bypass source revision filtering',
    async () => {
      await db.prepare('ALTER TABLE collection_state RENAME TO collection_state_unavailable').run()
      try {
        const dashboard = await mf.getWorker('dashboard')
        const response = await dashboard.fetch(origin + '/api/dashboard')
        assert.equal(response.status, 503)
        assert.equal((await response.json()).code, 'DATABASE_ERROR')
      } finally {
        await db
          .prepare('ALTER TABLE collection_state_unavailable RENAME TO collection_state')
          .run()
      }
    },
  )
})
