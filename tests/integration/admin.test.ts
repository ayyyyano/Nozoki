import { CONFIG_BODY_LIMIT } from '../../shared/contracts/admin.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { readConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = process.env.NOZOKI_ADMIN_EVIDENCE ?? '.wrangler/test-results/phase-04'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase04-tests', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase04-tests/run-'))
const script = (
  await build({
    entryPoints: ['tests/integration/admin-worker.ts'],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'browser',
    external: ['cloudflare:workers'],
  })
).outputFiles[0].text
const options = convertV4MiniflareOptions({
  modules: true,
  script,
  compatibilityDate: '2026-10-19',
  d1Databases: { DB: 'admin-isolated' },
  bindings: {
    ADMIN_EMAIL: 'owner@example.invalid',
    ADMIN_PASSWORD: 'SYNTHETIC-' + crypto.randomUUID(),
    AUTH_RATE_LIMIT_SECRET: randomToken(),
    AUTH_VERSION: '1',
    AUTH_ORIGIN: 'https://dashboard.invalid',
    INTEGRATION_ENCRYPTION_KEY: randomToken(),
    INTEGRATION_KEY_VERSION: 'v1',
  },
})
options.resourcePersistencePath = persist
let mf = new Miniflare(options),
  db = await mf.getD1Database('DB')
const report = { persist, checks: [], concurrent: null }
const save = async (input, key = crypto.randomUUID(), scope) =>
  JSON.parse(await (await mf.getWorker()).save(input, key, scope))
const input = async () => {
  const c = await readConfig(db)
  return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
}
const count = async (table) => (await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n
test('phase 04 atomic HTTP-save core in real D1/workerd', async (t) => {
  t.after(async () => {
    await mf.dispose()
    await writeFile(`${evidence}/admin-d1.json`, JSON.stringify(report, null, 2))
  })
  const check = (name, fn) =>
    t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  await check('new migration preserves old audit IDs, UTC and constraints', async () => {
    const files = (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()
    for (const f of files.slice(0, -1))
      await db.batch(
        unstable_splitSqlQuery(await readFile(`migrations/${f}`, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    const before = (await db.prepare('select * from integration_audit order by id').all()).results
    await db.batch(
      unstable_splitSqlQuery(await readFile(`migrations/${files.at(-1)}`, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
    assert.deepEqual(
      (await db.prepare('select * from integration_audit order by id').all()).results,
      before,
    )
    assert.deepEqual((await db.prepare('pragma foreign_key_check').all()).results, [])
  })
  await check('normalized no-op retains version/audit and has atomic retry result', async () => {
    const i = await input(),
      n = await count('integration_audit'),
      key = crypto.randomUUID()
    i.config.modules.reverse()
    const r = await save(i, key)
    assert.equal(r.success, true)
    assert.equal(r.changed, false)
    assert.equal(r.configVersion, i.expectedVersion)
    assert.equal(await count('integration_audit'), n)
    assert.equal((await save(i, key)).replayed, true)
  })
  await check(
    'streaming budget counts actual bytes despite missing or false Content-Length',
    async () => {
      const worker = await mf.getWorker()
      assert.equal(await worker.bodyProbe('1', CONFIG_BODY_LIMIT + 1), 413)
      assert.equal(await worker.bodyProbe(null, CONFIG_BODY_LIMIT + 1), 413)
      assert.equal(await worker.bodyProbe(String(CONFIG_BODY_LIMIT + 1), 1), 413)
      assert.equal(await worker.bodyProbe('1', 8192), 8192)
      assert.equal(await worker.bodyProbe('1', 4097, '/api/auth/login'), 413)
    },
  )
  await check(
    'concurrent identical retries commit one version and one real admin audit',
    async () => {
      const i = await input(),
        key = crypto.randomUUID(),
        n = await count('integration_audit')
      i.config.site.siteName = 'atomic-admin'
      const results = await Promise.all(Array.from({ length: 8 }, () => save(i, key)))
      assert.ok(results.every((r) => r.success && r.configVersion === i.expectedVersion + 1))
      assert.equal(await count('integration_audit'), n + 1)
      const audit = await db
        .prepare('select * from integration_audit where config_version=?')
        .bind(i.expectedVersion + 1)
        .first()
      assert.equal(audit.actor_kind, 'admin')
      assert.match(audit.actor_id, /^[a-f0-9]{64}$/)
      report.concurrent = {
        requests: 8,
        results,
        version: (await readConfig(db)).site.configVersion,
      }
      i.config.site.siteName = 'different'
      assert.equal((await save(i, key)).code, 'IDEMPOTENCY_CONFLICT')
    },
  )
  await check(
    'different requests CAS conflict without mixed config or success record',
    async () => {
      const a = await input(),
        b = structuredClone(a)
      a.config.site.siteName = 'winner-a'
      b.config.site.siteName = 'winner-b'
      b.config.links = []
      const keys = [crypto.randomUUID(), crypto.randomUUID()],
        before = await count('config_requests')
      const r = await Promise.all([save(a, keys[0]), save(b, keys[1])])
      assert.equal(r.filter((v) => v.success).length, 1)
      assert.equal(r.find((v) => !v.success).code, 'CONFIG_CONFLICT')
      assert.equal(await count('config_requests'), before + 1)
      const c = await readConfig(db)
      assert.equal(c.site.siteName, r[0].success ? 'winner-a' : 'winner-b')
      assert.equal(c.links.length, r[0].success ? a.config.links.length : 0)
    },
  )
  await check('SQL failure rolls version/audit/receipt back; retry then works', async () => {
    const i = await input(),
      key = crypto.randomUUID()
    i.config.site.siteName = 'rollback'
    const before = [
      await readConfig(db),
      await count('config_requests'),
      await count('integration_audit'),
    ]
    await db
      .prepare(
        "CREATE TRIGGER force_admin_failure BEFORE INSERT ON integration_audit WHEN NEW.actor_kind='admin' BEGIN SELECT RAISE(ABORT,'injected'); END",
      )
      .run()
    assert.equal((await save(i, key)).code, 'DATABASE_ERROR')
    assert.deepEqual(
      [await readConfig(db), await count('config_requests'), await count('integration_audit')],
      before,
    )
    await db.prepare('DROP TRIGGER force_admin_failure').run()
    assert.equal((await save(i, key)).success, true)
  })
  await check(
    'credential lifecycle, target binding and unverifiable capabilities reject atomically',
    async () => {
      let i = await input()
      i.config.modules.find((m) => m.id === 'quotes').sources = {}
      i.config.quotes.forEach((q) => {
        q.provider = null
      })
      const source = createIntegrationDraft('cliproxy', [], 'credential-fixture')
      source.baseUrl = 'https://source.example.com/api/'
      source.access.approved = true
      source.access.approvedTarget = sourceTargetKey(source, source.access)
      source.credential = { operation: 'replace', value: 'SYNTHETIC_PRIVATE_CREDENTIAL' }
      i.config.integrations = [source]
      const probe = JSON.parse(
        await (
          await mf.getWorker()
        ).testProof(source.id, {
          expectedVersion: i.expectedVersion,
          draft: source,
          quoteSymbols: [],
        }),
      )
      assert.ok(probe.connectionProof, JSON.stringify(probe))
      source.connectionProof = probe.connectionProof
      assert.equal((await save(i)).success, true)
      let c = await readConfig(db)
      assert.equal(c.integrations[0].credentialState.configured, true)
      assert.ok(!JSON.stringify(c).includes('SYNTHETIC_PRIVATE'))
      i = await input()
      i.config.integrations[0].baseUrl = 'https://source.example.com/other/'
      i.config.integrations[0].access.approvedTarget = sourceTargetKey(
        i.config.integrations[0],
        i.config.integrations[0].access,
      )
      const version = i.expectedVersion
      assert.equal((await save(i)).code, 'VALIDATION_ERROR')
      assert.equal((await readConfig(db)).site.configVersion, version)
      // Clearing the saved key is safe; a changed target still requires a new successful test.
      i = await input()
      i.config.integrations[0].credential = { operation: 'clear' }
      assert.equal((await save(i)).success, true)
      assert.equal((await readConfig(db)).integrations[0].credentialState.configured, false)
      i = await input()
      i.config.integrations[0].capabilities = { battery: { supported: true, verified: true } }
      assert.equal((await save(i)).code, 'VALIDATION_ERROR')
    },
  )
  await check(
    'unknown ACL paths fail, pointer special IDs and private ancestors remain valid',
    async () => {
      const i = await input(),
        m = i.config.modules.find((m) => m.id === 'devices')
      m.visibility = 'public'
      m.fields = { '/devices/@a.b~1c~0d': { enabled: true, visibility: 'admin' } }
      assert.equal((await save(i)).success, true)
      const b = await input()
      b.config.modules.find((m) => m.id === 'quotes').fields = {
        '/items/*/displayName': { enabled: true, visibility: 'admin' },
      }
      assert.equal((await save(b)).code, 'VALIDATION_ERROR')
    },
  )
  await check('receipt retention and restart persistence', async () => {
    const version = (await readConfig(db)).site.configVersion
    await db
      .prepare('DELETE FROM config_requests WHERE expires_at<=?')
      .bind('2000-01-01T00:00:00.000Z')
      .run()
    assert.ok((await count('config_requests')) > 0)
    await mf.dispose()
    mf = new Miniflare(options)
    db = await mf.getD1Database('DB')
    assert.equal((await readConfig(db)).site.configVersion, version)
    await db
      .prepare('DELETE FROM config_requests WHERE expires_at<=?')
      .bind('2099-01-01T00:00:00.000Z')
      .run()
    assert.equal(await count('config_requests'), 0)
  })
})
