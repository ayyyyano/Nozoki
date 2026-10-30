import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { source } from '../fixtures/adapters.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = '.wrangler/test-results/phase-05'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase05-tests', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase05-tests/run-')),
  script = (
    await build({
      entryPoints: ['tests/integration/adapters-worker.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:workers'],
    })
  ).outputFiles[0].text
const options = convertV4MiniflareOptions({
  modules: true,
  script,
  compatibilityDate: '2026-10-19',
  d1Databases: { DB: 'phase05-isolated' },
  bindings: {
    ADMIN_EMAIL: 'owner@example.invalid',
    ADMIN_PASSWORD: 'SYNTHETIC-' + crypto.randomUUID(),
    AUTH_RATE_LIMIT_SECRET: randomToken(),
    AUTH_VERSION: '1',
    AUTH_ORIGIN: 'https://dashboard.invalid',
  },
})
options.resourcePersistencePath = persist
let mf = new Miniflare(options),
  db = await mf.getD1Database('DB')
const report = { persist, runtime: 'isolated Miniflare copy + real workerd/D1', checks: [] }
test('phase 05 D1 connection-test admission and fail-closed services', async (t) => {
  t.after(async () => {
    await mf.dispose()
    await writeFile(`${evidence}/adapters-d1.json`, JSON.stringify(report, null, 2))
  })
  const check = (name, fn) =>
    t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  const reset = async () => {
    await db.prepare('DELETE FROM login_limits').run()
    await db
      .prepare(
        "UPDATE integration_test_slots SET request_token=NULL,expires_at='1970-01-01T00:00:00.000Z'",
      )
      .run()
  }
  const at = '2026-10-27T06:00:00.000Z'
  await check(
    'all migrations including bounded two-slot table apply with valid foreign keys',
    async () => {
      for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
        await db.batch(
          unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((s) =>
            db.prepare(s),
          ),
        )
      assert.equal((await db.prepare('select count(*) n from integration_test_slots').first()).n, 2)
      await assert.rejects(() =>
        db
          .prepare("insert into integration_test_slots values(3,NULL,'2026-10-27T06:00:00.000Z')")
          .run(),
      )
      assert.deepEqual((await db.prepare('pragma foreign_key_check').all()).results, [])
    },
  )
  await check(
    'eight concurrent distinct source attempts admit only two; token ownership prevents stale release',
    async () => {
      const w = await mf.getWorker(),
        r = await Promise.all(Array.from({ length: 8 }, (_, i) => w.reserve('s' + i, at))),
        ok = r.filter((v) => v.ok)
      assert.equal(ok.length, 2)
      assert.ok(r.filter((v) => !v.ok).every((v) => ['TEST_BUSY', 'TEST_LIMITED'].includes(v.code)))
      assert.equal(
        (
          await db
            .prepare(
              'select count(*) n from integration_test_slots where request_token is not null',
            )
            .first()
        ).n,
        2,
      )
      await w.release({ id: ok[0].slot.id, token: crypto.randomUUID() })
      assert.equal(
        (
          await db
            .prepare(
              'select count(*) n from integration_test_slots where request_token is not null',
            )
            .first()
        ).n,
        2,
      )
      for (const v of ok) await w.release(v.slot)
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
      const buckets = (await db.prepare('select * from login_limits').all()).results
      assert.ok(buckets.every((v) => /^[a-f0-9]{64}$/.test(v.key_hash)))
      assert.equal(Math.max(...buckets.map((v) => v.failures)), 6)
    },
  )
  await check(
    'per-source count is atomic, cooldown persists restart and expires; lost slots recover',
    async () => {
      await reset()
      const w = await mf.getWorker(),
        results = await Promise.all(Array.from({ length: 5 }, () => w.reserve('same', at)))
      assert.equal(results.filter((v) => v.ok).length, 2)
      assert.ok(results.filter((v) => !v.ok).every((v) => v.code === 'TEST_LIMITED'))
      await mf.dispose()
      mf = new Miniflare(options)
      db = await mf.getD1Database('DB')
      assert.equal((await (await mf.getWorker()).reserve('same', at)).code, 'TEST_LIMITED')
      const later = await (await mf.getWorker()).reserve('same', '2026-10-27T06:02:00.000Z')
      assert.equal(later.ok, true)
      await (await mf.getWorker()).release(later.slot)
    },
  )
  await check('upstream Retry-After creates durable cooldown without retrying', async () => {
    await reset()
    const w = await mf.getWorker(),
      r = await w.reserve('delayed', at)
    await w.release(r.slot)
    await w.defer(r.slot.sourceHash, 300, at)
    assert.equal((await w.reserve('delayed', '2026-10-27T06:02:00.000Z')).code, 'TEST_LIMITED')
    const next = await w.reserve('delayed', '2026-10-27T06:06:00.000Z')
    assert.equal(next.ok, true)
    await w.release(next.slot)
  })
  await check(
    'saved custom source is denied; no config/audit/snapshot/run writes; disabled sources not read',
    async () => {
      await reset()
      const c = await readConfig(db),
        i = source('sleepy'),
        { credentialState: _, ...base } = i,
        config = editableConfig(c)
      config.integrations = [{ ...base, credential: { operation: 'keep' } }]
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
      const business = async () =>
        Promise.all(
          [
            'site_settings',
            'integrations',
            'integration_audit',
            'integration_snapshots',
            'integration_snapshot_views',
            'collection_runs',
            'daily_usage',
          ].map(
            async (table) =>
              (await db.prepare(`select * from ${table} order by rowid`).all()).results,
          ),
        )
      const before = await business(),
        r = JSON.parse(await (await mf.getWorker()).probe(i.id))
      assert.equal(r.code, 'TARGET_NOT_APPROVED')
      assert.equal(r.status, 'unsupported')
      assert.deepEqual(await business(), before)
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
      await db.prepare('update integrations set enabled=0 where id=?').bind(i.id).run()
      assert.equal(JSON.parse(await (await mf.getWorker()).probe(i.id)).code, 'SOURCE_DISABLED')
    },
  )
  await check('admission D1 fault fails closed without success result', async () => {
    await reset()
    await db.prepare('DROP TABLE integration_test_slots').run()
    const r = await (await mf.getWorker()).reserve('fault', at)
    assert.equal(r.ok, false)
  })
})
