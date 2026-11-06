import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { readGuestDashboard } from '../../server/services/dashboard.ts'
import {
  importCredentialKey,
  decryptCredential,
  encryptCredential,
} from '../../server/services/credentials.ts'
import { cleanupRecords } from '../../server/services/retention.ts'
import { upsertDailyUsage, upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { createUnconfiguredDashboard, snapshot } from '../../shared/domain/dashboard.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = process.env.NOZOKI_TEST_EVIDENCE ?? '.wrangler/test-results/phase-02'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase02-tests', { recursive: true })
const persist = resolve(await mkdtemp('.wrangler/phase02-tests/run-'))
const harness = await build({
  entryPoints: ['tests/integration/worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:workers'],
})
const options = convertV4MiniflareOptions({
  modules: true,
  script: harness.outputFiles[0].text,
  compatibilityDate: '2026-10-19',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: { DB: '00000000-0000-0000-0000-000000000002' },
})
// Miniflare 5's V4 converter does not map d1Persist; its actual instance option is explicit.
options.resourcePersistencePath = persist
const report = {
  runtime: wrangler('miniflare/package.json').version,
  persist,
  checks: [],
  concurrency: null,
}
let mf = new Miniflare(options),
  db = await mf.getD1Database('DB')
const now = '2026-10-26T10:00:00.000Z',
  actor = { kind: 'system', id: 'local-integration-test' }
const writeOf = (c) => ({
  ...structuredClone(c),
  integrations: c.integrations.map(({ credentialState: _state, ...i }) => ({
    ...i,
    credential: { operation: 'keep' },
  })),
})
const inputOf = (c) => ({ expectedVersion: c.site.configVersion, config: writeOf(c) })
const integration = (id = 'sleepy-test') => ({
  id,
  provider: 'sleepy',
  protocolVersion: 'fixture-v1',
  baseUrl: 'https://example.invalid/',
  enabled: true,
  refreshInterval: 300,
  fieldMappings: {},
  capabilities: {},
  credential: { operation: 'keep' },
})
const rowCount = async (table) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n // Fixed test-only allow-list call sites.
async function saveCurrent(change, keys) {
  const c = await readConfig(db),
    v = inputOf(c)
  change(v.config)
  return saveConfig(db, v, { actor, keys, now: new Date(now) })
}
const audited = async () => ({
  version: (await readConfig(db)).site.configVersion,
  audits: await rowCount('integration_audit'),
})
test('phase 02 uses real local workerd D1, not an SQLite mock', async (t) => {
  t.after(async () => {
    await mf.dispose()
    await writeFile(`${evidence}/d1-integration.json`, JSON.stringify(report, null, 2))
  })
  const check = async (name, fn) =>
    t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  await check('empty D1 applies every SQL migration and matches runtime defaults', async () => {
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    const defaults = createDefaultConfig()
    defaults.site.configVersion = 3
    assert.deepEqual(await readConfig(db), defaults)
    assert.equal(await rowCount('dashboard_modules'), 8)
    assert.equal(await rowCount('quote_symbols'), 2)
    assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1)
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
  })
  await check('normal CAS saves the full package and increments the version', async () => {
    const old = await audited()
    const result = await saveCurrent((c) => {
      c.site.siteName = 'Persisted Local Nozoki'
      c.quotes[0].displayName = 'Saved QQQM'
      c.integrations.push(integration())
    })
    assert.deepEqual(result, { success: true, configVersion: old.version + 1 })
    assert.equal((await readConfig(db)).site.siteName, 'Persisted Local Nozoki')
    assert.equal(await rowCount('config_write_guard'), 0)
  })
  await check(
    'parallel requests based on N produce one winner without mixed rows or audit residue',
    async () => {
      const c = await readConfig(db),
        a = inputOf(c),
        b = inputOf(c),
        before = await rowCount('integration_audit')
      for (const [value, label] of [
        [a, 'A'],
        [b, 'B'],
      ]) {
        value.config.site.siteName = `Winner ${label}`
        value.config.modules[0].title = `Title ${label}`
        value.config.quotes[0].displayName = `Quote ${label}`
        value.config.links[0].title = `Link ${label}`
        value.config.integrations[0].baseUrl = `https://${label.toLowerCase()}.example.invalid/`
      }
      const worker = await mf.getWorker()
      const results = (await Promise.all([worker.save(a), worker.save(b)])).map((v) =>
        JSON.parse(v),
      )
      report.concurrency = {
        expectedVersion: c.site.configVersion,
        execution: 'workerd WorkerEntrypoint RPC',
        results,
      }
      assert.equal(results.filter((r) => r.success).length, 1)
      assert.equal(results.filter((r) => r.code === 'CONFIG_CONFLICT').length, 1)
      const winner = results[0].success ? 'A' : 'B',
        saved = await readConfig(db)
      assert.equal(saved.site.siteName, `Winner ${winner}`)
      assert.equal(saved.modules[0].title, `Title ${winner}`)
      assert.equal(saved.quotes[0].displayName, `Quote ${winner}`)
      assert.equal(saved.links[0].title, `Link ${winner}`)
      assert.equal(
        saved.integrations[0].baseUrl,
        `https://${winner.toLowerCase()}.example.invalid/`,
      )
      assert.equal(await rowCount('integration_audit'), before + 1)
      assert.equal(await rowCount('config_write_guard'), 0)
      assert.equal((await saveConfig(db, a, { actor })).code, 'CONFIG_CONFLICT')
    },
  )
  await check(
    'a real mid-batch SQL ABORT rolls back version, modules, integrations, quotes and audit',
    async () => {
      const before = await readConfig(db),
        audit = await rowCount('integration_audit')
      await db
        .prepare(
          "CREATE TRIGGER phase02_fault BEFORE INSERT ON quote_symbols WHEN NEW.symbol='BROKEN' BEGIN SELECT RAISE(ABORT,'LOCAL_FAULT_INJECTION'); END",
        )
        .run()
      const result = await saveCurrent((c) => {
        c.site.siteName = 'Must Roll Back'
        c.modules[0].title = 'Must Roll Back'
        c.integrations[0].baseUrl = 'https://rollback.invalid/'
        c.quotes[0].symbol = 'BROKEN'
      })
      assert.deepEqual(result, { success: false, code: 'DATABASE_ERROR' })
      assert.deepEqual(await readConfig(db), before)
      assert.equal(await rowCount('integration_audit'), audit)
      assert.equal(await rowCount('config_write_guard'), 0)
      await db.prepare('DROP TRIGGER phase02_fault').run()
    },
  )
  await check(
    'invalid fields, URLs, modules, duplicate nullable-provider symbols never enter D1',
    async () => {
      const before = await audited()
      for (const mutate of [
        (c) => (c.site.unexpected = 'bad'),
        (c) => (c.site.background.url = 'javascript:alert(1)'),
        (c) => (c.modules[0].id = 'unknown'),
        (c) => c.quotes.push({ ...c.quotes[0] }),
        (c) => (c.integrations[0].credential = { operation: 'replace', value: '' }),
        (c) => (c.modules[0].fields = { balance: { enabled: true, visibility: 'public' } }),
      ]) {
        const current = await readConfig(db),
          input = inputOf(current)
        mutate(input.config)
        assert.equal((await saveConfig(db, input, { actor })).code, 'VALIDATION_ERROR')
      }
      assert.deepEqual(await audited(), before)
    },
  )
  await check(
    'AES-GCM encrypts, authenticates AAD, rejects tampering and supports key versions',
    async () => {
      assert.deepEqual(JSON.parse(await (await mf.getWorker()).cryptoProbe()), {
        roundtrip: true,
        authenticated: true,
        providerBound: true,
        versionBound: true,
        aadAuthenticated: true,
        legacyRoundtrip: true,
        algorithm: 'AES-GCM',
        keyVersion: 'worker-v1',
      })
      const v1 = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32))),
        v2 = await importCredentialKey('v2', crypto.getRandomValues(new Uint8Array(32)))
      const token = 'SYNTHETIC_CREDENTIAL_DO_NOT_LOG',
        before = await audited()
      assert.equal(
        (
          await saveCurrent(
            (c) => (c.integrations[0].credential = { operation: 'replace', value: token }),
          )
        ).code,
        'VALIDATION_ERROR',
      )
      assert.deepEqual(await audited(), before)
      assert.equal(
        (
          await saveCurrent(
            (c) => (c.integrations[0].credential = { operation: 'replace', value: token }),
            v1,
          )
        ).success,
        true,
      )
      const stored = await readStoredState(db),
        envelope = stored.integrations[0].envelope
      assert.equal(await decryptCredential('sleepy-test', 'sleepy', envelope, v1), token)
      await assert.rejects(() => decryptCredential('other-source', 'sleepy', envelope, v1))
      await assert.rejects(() => decryptCredential('sleepy-test', 'deepseek', envelope, v1))
      // Same raw key under another version isolates the AAD binding from key selection.
      await assert.rejects(() =>
        decryptCredential(
          'sleepy-test',
          'sleepy',
          { ...envelope, keyVersion: 'alias' },
          { activeVersion: 'alias', keys: { alias: v1.keys.v1 } },
        ),
      )
      const forged = await encryptCredential('sleepy-test', 'deepseek', token, v1, now)
      await assert.rejects(() => decryptCredential('sleepy-test', 'sleepy', forged, v1))
      assert.equal(await decryptCredential('sleepy-test', 'sleepy', envelope, v1), token)
      await assert.rejects(() =>
        decryptCredential('sleepy-test', 'sleepy', envelope, {
          activeVersion: 'v1',
          keys: { v1: v2.keys.v2 },
        }),
      )
      await assert.rejects(() =>
        decryptCredential(
          'sleepy-test',
          'sleepy',
          {
            ...envelope,
            ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1),
          },
          v1,
        ),
      )
      const rotated = { activeVersion: 'v2', keys: { ...v1.keys, ...v2.keys } }
      assert.equal(await decryptCredential('sleepy-test', 'sleepy', envelope, rotated), token)
      const newer = await encryptCredential('sleepy-test', 'sleepy', token, rotated, now)
      assert.equal(newer.keyVersion, 'v2')
      assert.notEqual(newer.iv, envelope.iv)
      await assert.rejects(() => decryptCredential('sleepy-test', 'sleepy', newer, v1))
      await saveCurrent((c) => (c.site.siteName = 'Keep Credential'))
      assert.deepEqual((await readStoredState(db)).integrations[0].envelope, envelope)
      const returned = JSON.stringify(await readConfig(db)),
        audit = JSON.stringify((await db.prepare('SELECT * FROM integration_audit').all()).results)
      for (const secret of [token, envelope.ciphertext, envelope.iv]) {
        assert.ok(!returned.includes(secret))
        assert.ok(!audit.includes(secret))
      }
      await saveCurrent((c) => (c.integrations[0].credential = { operation: 'clear' }))
      assert.deepEqual((await readConfig(db)).integrations[0].credentialState, {
        configured: false,
        keyVersion: null,
        lastUpdatedAt: null,
      })
    },
  )
  await check(
    'real D1 constraints reject duplicate keys, missing FKs, invalid JSON and invalid money',
    async () => {
      const q = await db.prepare('SELECT * FROM quote_symbols LIMIT 1').first()
      await assert.rejects(() =>
        db
          .prepare('INSERT INTO quote_symbols VALUES(?,?,?,?,?,?,?,?)')
          .bind('duplicate', q.market, q.symbol, q.display_name, q.provider, 0, 1, 300)
          .run(),
      )
      await assert.rejects(() =>
        db
          .prepare(
            "INSERT INTO daily_usage VALUES('no-such-source','2026-10-26','Asia/Shanghai','USD','spend','1.00',?)",
          )
          .bind(now)
          .run(),
      )
      await assert.rejects(() =>
        db.prepare("UPDATE dashboard_modules SET fields_json='not-json' WHERE id='devices'").run(),
      )
      await assert.rejects(() =>
        db
          .prepare(
            "INSERT INTO daily_usage VALUES('sleepy-test','2026-10-26','Asia/Shanghai','USD','spend','1.2.3',?)",
          )
          .bind(now)
          .run(),
      )
      await assert.rejects(() =>
        db
          .prepare(
            "INSERT INTO dashboard_modules VALUES('not-a-module',1,'x',0,'public','hidden','{}','{}')",
          )
          .run(),
      )
    },
  )
  await check(
    'exact decimal round trip and latest snapshot upsert do not add duplicate history',
    async () => {
      const amount = '123456789012345678901234567890.00000000000000000001'
      await upsertDailyUsage(db, {
        sourceId: 'sleepy-test',
        day: '2026-10-26',
        timezone: 'Asia/Shanghai',
        currency: 'USD',
        dimension: 'spend',
        amount,
        updatedAt: now,
      })
      await upsertDailyUsage(db, {
        sourceId: 'sleepy-test',
        day: '2026-10-26',
        timezone: 'Asia/Shanghai',
        currency: 'USD',
        dimension: 'spend',
        amount,
        updatedAt: now,
      })
      assert.equal((await db.prepare('SELECT amount FROM daily_usage').first()).amount, amount)
      assert.equal(await rowCount('daily_usage'), 1)
      const devices = snapshot(
        'ok',
        {
          devices: [
            {
              id: 'public-device',
              name: 'Public Device',
              using: true,
              stateText: 'PRIVATE_APP',
              online: true,
              batteryPercent: 0,
              charging: false,
              observedAt: now,
              heartbeatAt: now,
              capabilities: {},
            },
            {
              id: 'private-device',
              name: 'PRIVATE_DEVICE',
              using: true,
              stateText: 'PRIVATE_STATE',
              online: true,
              batteryPercent: 88,
              charging: true,
              observedAt: now,
              heartbeatAt: now,
              capabilities: {},
            },
          ],
        },
        'sleepy-test',
      )
      devices.expiresAt = '2026-10-27T00:00:00.000Z'
      const v = {
        sourceId: 'sleepy-test',
        subject: 'devices',
        moduleId: 'devices',
        snapshot: devices,
        updatedAt: now,
      }
      await upsertSnapshot(db, v)
      await upsertSnapshot(db, v)
      assert.equal(await rowCount('integration_snapshots'), 1)
    },
  )
  await check(
    'guest projection filters private modules, fields, nested items, sources and service summary',
    async () => {
      await saveCurrent((c) => {
        const devices = c.modules.find((m) => m.id === 'devices')
        devices.visibility = 'public'
        devices.sources.main = { sourceId: 'sleepy-test', subject: 'devices' }
        devices.fields = {
          'devices.*.stateText': { enabled: true, visibility: 'admin' },
          'devices.@private-device': { enabled: true, visibility: 'admin' },
        }
        c.modules.find((m) => m.id === 'codex').enabled = false
        c.modules.find((m) => m.id === 'services').guestBehavior = 'hidden'
        c.links.push({
          id: 'private-link',
          title: 'PRIVATE_LINK',
          url: 'https://private-link.invalid/secret',
          icon: 'link',
          sortOrder: 9,
          enabled: true,
          visibility: 'admin',
        })
      })
      const result = await readGuestDashboard(db, new Date(now)),
        wire = JSON.stringify(result),
        dev = result.modules.find((m) => m.id === 'devices').snapshot.data.devices
      assert.equal(result.viewer, 'guest')
      assert.equal(result.contractVersion, 1)
      assert.equal(dev.length, 1)
      assert.equal(dev[0].batteryPercent, 0)
      for (const value of [
        'PRIVATE_APP',
        'PRIVATE_DEVICE',
        'PRIVATE_STATE',
        'PRIVATE_LINK',
        'private-link.invalid',
        'sleepy-test',
        'credential',
        'baseUrl',
        'sourceId',
      ])
        assert.ok(!wire.includes(value), value)
      const hint = result.modules.find((m) => m.id === 'deepseek')
      assert.deepEqual(Object.keys(hint).sort(), ['id', 'kind', 'sortOrder', 'title'])
      assert.equal(hint.kind, 'login_required')
      assert.ok(!result.modules.some((m) => m.id === 'services' || m.id === 'codex'))
      assert.deepEqual(result.summary, {})
      const old = result.configVersion
      await saveCurrent((c) => (c.integrations[0].baseUrl = 'https://private-change.invalid/'))
      assert.equal((await readGuestDashboard(db, new Date(now))).configVersion, old)
      await saveCurrent((c) => {
        c.modules.find((m) => m.id === 'devices').fields['devices.*.stateText'] = {
          enabled: true,
          visibility: 'public',
        }
      })
      assert.notEqual((await readGuestDashboard(db, new Date(now))).configVersion, old)
      await saveCurrent((c) => {
        c.modules.find((m) => m.id === 'devices').fields['devices.*.stateText'] = {
          enabled: true,
          visibility: 'admin',
        }
      })
      assert.equal((await readGuestDashboard(db, new Date(now))).configVersion, old)
    },
  )
  await check(
    'private monitors cannot leak through arrays or top summary; errors are not service down',
    async () => {
      await saveCurrent((c) => {
        const m = c.modules.find((m) => m.id === 'services')
        m.visibility = 'public'
        m.sources.main = { sourceId: 'sleepy-test', subject: 'services' }
        m.fields = { 'monitors.@private-monitor': { enabled: true, visibility: 'admin' } }
      })
      const monitors = [
        {
          id: 'public-monitor',
          name: 'Public Site',
          state: 'up',
          latencyMs: 0,
          checkedAt: now,
          statusPageUrl: null,
          uptimePercent: null,
          capabilities: {},
        },
        {
          id: 'private-monitor',
          name: 'PRIVATE_MONITOR',
          state: 'down',
          latencyMs: null,
          checkedAt: now,
          statusPageUrl: null,
          uptimePercent: null,
          capabilities: {},
        },
      ]
      await upsertSnapshot(db, {
        sourceId: 'sleepy-test',
        subject: 'services',
        moduleId: 'services',
        snapshot: snapshot('stale', { monitors }, 'sleepy-test'),
        updatedAt: now,
      })
      let result = await readGuestDashboard(db, new Date(now))
      assert.deepEqual(result.summary, { services: { up: 1, down: 0 } })
      assert.ok(!JSON.stringify(result).includes('PRIVATE_MONITOR'))
      await upsertSnapshot(db, {
        sourceId: 'sleepy-test',
        subject: 'services',
        moduleId: 'services',
        snapshot: snapshot('error', null, 'sleepy-test'),
        updatedAt: now,
      })
      result = await readGuestDashboard(db, new Date(now))
      assert.deepEqual(result.summary, {})
      assert.equal(result.modules.find((m) => m.id === 'services').snapshot.status, 'error')
    },
  )
  await check(
    'retention separately prunes snapshots, runs, audits, usage, sessions, limits and imports',
    async () => {
      const old = '2020-01-01T00:00:00.000Z'
      await upsertSnapshot(db, {
        sourceId: 'sleepy-test',
        subject: 'old',
        moduleId: 'devices',
        snapshot: snapshot('error', null, 'sleepy-test'),
        updatedAt: old,
      })
      await upsertDailyUsage(db, {
        sourceId: 'sleepy-test',
        day: '2020-01-01',
        timezone: 'Asia/Shanghai',
        currency: 'USD',
        dimension: 'spend',
        amount: '0.00',
        updatedAt: old,
      })
      await db.batch([
        db
          .prepare(
            "INSERT INTO collection_runs(id,source_id,config_version,status,started_at,finished_at,error_code) VALUES('old-run','sleepy-test',1,'failure',?,?,NULL)",
          )
          .bind(old, old),
        db
          .prepare(
            "INSERT INTO integration_audit VALUES('old-audit','config_save',1,'[]','system','local-test','failure',?)",
          )
          .bind(old),
        db
          .prepare('INSERT INTO sessions VALUES(?,1,?,?,?,?,NULL)')
          .bind('a'.repeat(64), old, old, old, old),
        db
          .prepare('INSERT INTO sessions VALUES(?,1,?,?,?,?,NULL)')
          .bind('b'.repeat(64), now, now, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z'),
        db.prepare('INSERT INTO login_limits VALUES(?,1,?,NULL,?)').bind('c'.repeat(64), old, old),
        db
          .prepare("INSERT INTO import_batches VALUES('old-import','sleepy-test',?,'complete',?)")
          .bind('d'.repeat(64), old),
      ])
      await db
        .prepare('INSERT INTO config_requests VALUES(?,?,?,?,?,?,?)')
        .bind(
          'e'.repeat(64),
          crypto.randomUUID(),
          'f'.repeat(64),
          1,
          1,
          old,
          '2020-01-02T00:00:00.000Z',
        )
        .run()
      const changes = await cleanupRecords(db, new Date(now))
      assert.equal(await rowCount('config_requests'), 0)
      assert.ok(changes.every((n) => n >= 1))
      assert.equal(await rowCount('daily_usage'), 1)
      assert.equal(await rowCount('sessions'), 1)
      assert.equal(await rowCount('import_batches'), 0)
    },
  )
  await check(
    'source removal with retained history is rejected atomically instead of cascading it away',
    async () => {
      const before = await readConfig(db),
        c = inputOf(before)
      c.config.integrations = []
      for (const m of c.config.modules) m.sources = {}
      const result = await saveConfig(db, c, { actor })
      assert.equal(result.code, 'VALIDATION_ERROR')
      assert.deepEqual(await readConfig(db), before)
      assert.equal(await rowCount('daily_usage'), 1)
    },
  )
  await check(
    'nested Codex account/window arrays and private usage cannot escape public field rules',
    async () => {
      await saveCurrent((c) => {
        const m = c.modules.find((m) => m.id === 'codex')
        m.enabled = true
        m.visibility = 'public'
        m.sources.main = { sourceId: 'sleepy-test', subject: 'codex' }
        m.fields = {
          usage: { enabled: true, visibility: 'admin' },
          estimatedCost: { enabled: true, visibility: 'admin' },
          'quota.accounts.@private-account': { enabled: true, visibility: 'admin' },
          'quota.accounts.*.windows.@private-window': { enabled: true, visibility: 'admin' },
        }
      })
      const data = {
        usage: { scope: 'PRIVATE_SCOPE', coverageStart: null, days: [] },
        quota: {
          accounts: [
            {
              id: 'public-account',
              windows: [
                {
                  id: 'public-window',
                  label: 'Visible Window',
                  remainingPercent: '72.00',
                  resetAt: null,
                },
                {
                  id: 'private-window',
                  label: 'PRIVATE_WINDOW',
                  remainingPercent: '13.00',
                  resetAt: null,
                },
              ],
            },
            {
              id: 'private-account',
              windows: [
                {
                  id: 'other-window',
                  label: 'PRIVATE_ACCOUNT',
                  remainingPercent: '1.00',
                  resetAt: null,
                },
              ],
            },
          ],
        },
        estimatedCost: { currency: 'USD', amount: '99.00', basis: 'PRIVATE_BASIS' },
        capabilities: {
          usage: { supported: true, verified: false },
          quota: { supported: true, verified: false },
          estimatedCost: { supported: true, verified: false },
        },
      }
      await upsertSnapshot(db, {
        sourceId: 'sleepy-test',
        subject: 'codex',
        moduleId: 'codex',
        snapshot: snapshot('ok', data, 'sleepy-test'),
        updatedAt: now,
      })
      const wire = JSON.stringify(await readGuestDashboard(db, new Date(now)))
      for (const s of ['PRIVATE_SCOPE', 'PRIVATE_WINDOW', 'PRIVATE_ACCOUNT', 'PRIVATE_BASIS'])
        assert.ok(!wire.includes(s))
      assert.ok(wire.includes('Visible Window'))
      assert.ok(wire.includes('72.00'))
    },
  )
  await check(
    'missing or corrupt singleton fails closed without creating a second configuration',
    async () => {
      const row = await db.prepare('SELECT * FROM site_settings').first(),
        input = inputOf(await readConfig(db))
      await db.prepare('DELETE FROM site_settings').run()
      await assert.rejects(() => readConfig(db), /CONFIG_NOT_INITIALIZED/)
      assert.equal((await saveConfig(db, input, { actor })).code, 'DATABASE_ERROR')
      assert.equal(await rowCount('site_settings'), 0)
      await assert.rejects(
        () =>
          db
            .prepare('INSERT INTO config_write_guard VALUES(1,?,?)')
            .bind('missing-baseline', input.expectedVersion)
            .run(),
        /NOZOKI_BASELINE_INVALID/,
      )
      await db
        .prepare('INSERT INTO site_settings VALUES(?,?,?,?,?,?)')
        .bind(
          row.id,
          row.config_version,
          row.settings_json,
          row.links_json,
          row.write_token,
          row.updated_at,
        )
        .run()
      await db.prepare("UPDATE site_settings SET settings_json='{}'").run()
      assert.equal((await saveConfig(db, input, { actor })).code, 'DATABASE_ERROR')
      await db.prepare('UPDATE site_settings SET settings_json=?').bind(row.settings_json).run()
    },
  )
  await check(
    'dispose and restart of actual workerd preserves saved configuration and exact decimals',
    async () => {
      const previous = await readConfig(db),
        amount = (await db.prepare('SELECT amount FROM daily_usage').first()).amount
      await mf.dispose()
      mf = new Miniflare(options)
      db = await mf.getD1Database('DB')
      assert.deepEqual(await readConfig(db), previous)
      assert.equal((await db.prepare('SELECT amount FROM daily_usage').first()).amount, amount)
    },
  )
})
