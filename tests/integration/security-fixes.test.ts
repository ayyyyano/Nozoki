import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ConfigSchema, createDefaultConfig } from '../../shared/contracts/config.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { readGuestDashboard } from '../../server/services/dashboard.ts'
import {
  importCredentialKey,
  encryptCredential,
  decryptCredential,
} from '../../server/services/credentials.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = process.env.NOZOKI_TEST_EVIDENCE ?? '.wrangler/test-results/phase-02-fixes'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase02-fixes', { recursive: true })
const persist = resolve(await mkdtemp('.wrangler/phase02-fixes/security-'))
const options = convertV4MiniflareOptions({
  modules: true,
  script: 'export default {fetch(){return new Response("isolated")}}',
  d1Databases: { DB: 'fixes', LEGACY: 'legacy-invalid' },
})
options.resourcePersistencePath = persist
let mf = new Miniflare(options),
  db = await mf.getD1Database('DB')
const now = '2026-10-26T10:00:00.000Z',
  actor = { kind: 'system', id: 'security-fixes' }
const keys = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
const envelope = await encryptCredential(
  'shared-source',
  'sleepy',
  'SYNTHETIC_OLD_TOKEN',
  keys,
  now,
)
const policy = { enabled: true, visibility: 'admin' }
const source = 'shared-source',
  subject = 'shared'
const migrations = (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()
const apply = async (database, files) => {
  for (const file of files)
    await database.batch(
      unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map((sql) =>
        database.prepare(sql),
      ),
    )
}
const report = {
  runtime: wrangler('miniflare/package.json').version,
  persist,
  checks: [],
  targetCases: [],
  aclCases: [],
}
async function input() {
  const c = await readConfig(db)
  return {
    expectedVersion: c.site.configVersion,
    config: {
      ...c,
      integrations: c.integrations.map(({ credentialState, ...s }) => ({
        ...s,
        credential: { operation: 'keep' },
      })),
    },
  }
}
async function save(change, ring = keys) {
  const value = await input()
  change(value.config)
  return saveConfig(db, value, { actor, keys: ring, now: new Date(now) })
}
async function allRows() {
  const names = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY name",
      )
      .all()
  ).results.map((r) => r.name)
  return JSON.stringify(
    await Promise.all(
      names.map(async (name) => [
        name,
        (await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results,
      ]),
    ),
  )
}
const device = (id) => ({
  id,
  name: 'PRIVATE_' + id,
  using: true,
  stateText: 'PRIVATE_STATE',
  online: true,
  batteryPercent: 0,
  charging: false,
  observedAt: now,
  heartbeatAt: now,
  capabilities: {},
})
const store = async (moduleId, data, time = now) => {
  await upsertSnapshot(db, {
    sourceId: source,
    subject,
    moduleId,
    snapshot: snapshot('ok', data, source),
    updatedAt: time,
  })
  // This ACL-only fixture represents a fresh validated view for the current source.
  // Production collection uses commitCollection and its lease/revision transaction guard.
  await db
    .prepare(
      `UPDATE integration_snapshot_views SET source_revision=(
    SELECT collection_generation||':'||collection_revision FROM integrations WHERE id=?)
    WHERE source_id=? AND subject=? AND module_id=? AND updated_at=?`,
    )
    .bind(source, source, subject, moduleId, time)
    .run()
}
const legacySnapshot = snapshot('ok', { devices: [device('legacy')] }, source)
test('phase 02 security fixes on isolated real workerd D1', async (t) => {
  t.after(async () => {
    await mf.dispose()
    await writeFile(`${evidence}/security-fixes.json`, JSON.stringify(report, null, 2))
  })
  const check = (name, fn) =>
    t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  await check(
    'forward migrations preserve populated v4 configuration, ciphertext and snapshots',
    async () => {
      await apply(
        db,
        migrations.filter((f) => f < '0005'),
      )
      await db
        .prepare(
          `INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json,credential_ciphertext,credential_iv,credential_key_version,credential_algorithm,credential_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          source,
          'sleepy',
          'fixture-v1',
          'https://example.invalid/api/',
          1,
          300,
          '{}',
          '{}',
          envelope.ciphertext,
          envelope.iv,
          envelope.keyVersion,
          envelope.algorithm,
          envelope.updatedAt,
        )
        .run()
      await db
        .prepare('INSERT INTO integration_snapshots VALUES(?,?,?,?,?)')
        .bind(source, subject, 'devices', JSON.stringify(legacySnapshot), now)
        .run()
      const configBefore = JSON.stringify(
        (await db.prepare('SELECT * FROM site_settings').all()).results,
      )
      const old = await db.prepare('SELECT * FROM integration_snapshots').first()
      await apply(
        db,
        migrations.filter((f) => f >= '0005'),
      )
      const prior = JSON.parse(configBefore)[0],
        updated = await db.prepare('SELECT * FROM site_settings').first()
      assert.equal(updated.settings_json, prior.settings_json)
      assert.equal(updated.links_json, prior.links_json)
      assert.equal(updated.config_version, prior.config_version + 3)
      const upgraded = await db.prepare('SELECT * FROM integration_snapshot_views').first()
      assert.deepEqual(Object.fromEntries(Object.keys(old).map((key) => [key, upgraded[key]])), old)
      assert.match(upgraded.source_revision, /^[a-f0-9]{32}:1$/)
      assert.equal(upgraded.environment_epoch, null)
      assert.deepEqual((await readStoredState(db)).integrations[0].envelope, envelope)
      assert.equal(await decryptCredential(source, 'sleepy', envelope, keys), 'SYNTHETIC_OLD_TOKEN')
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
      assert.ok(ConfigSchema.safeParse(await readConfig(db)).success)
    },
  )
  await check(
    'invalid old timestamps abort migration without silently changing dates',
    async () => {
      const legacy = await mf.getD1Database('LEGACY')
      await apply(
        legacy,
        migrations.filter((f) => f < '0006'),
      )
      await legacy.prepare("UPDATE site_settings SET updated_at='2026-02-30T00:00:00.000Z'").run()
      await assert.rejects(
        () =>
          apply(
            legacy,
            migrations.filter((f) => f >= '0006'),
          ),
        /INVALID_LEGACY_UTC_TIMESTAMP/,
      )
      assert.equal(
        (await legacy.prepare('SELECT updated_at FROM site_settings').first()).updated_at,
        '2026-02-30T00:00:00.000Z',
      )
      assert.equal(
        (
          await legacy
            .prepare("SELECT count(*) n FROM sqlite_master WHERE name='utc_migration_guard'")
            .first()
        ).n,
        0,
      )
    },
  )
  await check(
    'same and equivalent full service roots keep exact ciphertext; changed targets reject atomically',
    async () => {
      for (const target of [
        'https://example.invalid/api/',
        'https://EXAMPLE.invalid:443/api',
        'https://example.invalid/x/../api/',
        'https://example.invalid/%61pi/',
      ]) {
        const result = await save((c) => (c.integrations[0].baseUrl = target))
        assert.equal(result.success, true)
        assert.deepEqual((await readStoredState(db)).integrations[0].envelope, envelope)
        report.targetCases.push({ target, operation: 'keep', accepted: true })
      }
      for (const [field, target] of [
        ['baseUrl', 'https://other.invalid/api/'],
        ['baseUrl', 'https://example.invalid/other/'],
        ['baseUrl', 'https://example.invalid/API/'],
        ['baseUrl', 'https://example.invalid/api%2F/'],
        ['baseUrl', 'https://example.invalid/api//'],
        ['provider', 'deepseek'],
      ]) {
        const before = await allRows()
        const result = await save((c) => {
          c.integrations[0][field] = target
          c.site.siteName = 'MUST_ROLL_BACK'
          c.quotes[0].displayName = 'MUST_ROLL_BACK'
        })
        assert.equal(result.code, 'VALIDATION_ERROR')
        assert.equal(await allRows(), before)
        report.targetCases.push({
          field,
          target,
          operation: 'keep',
          accepted: false,
          databaseUnchanged: true,
        })
      }
      const before = await allRows()
      assert.equal(
        (
          await save((c) => {
            c.integrations[0].baseUrl = null
            c.integrations[0].enabled = false
          })
        ).code,
        'VALIDATION_ERROR',
      )
      assert.equal(await allRows(), before)
      assert.equal(
        (await saveConfig(db, await input(), { actor, now: new Date('invalid') })).code,
        'VALIDATION_ERROR',
      )
      assert.equal(await allRows(), before)
    },
  )
  await check(
    'changed target plus replace or clear succeeds without AEAD v1 regression',
    async () => {
      const before = await allRows()
      await db
        .prepare(
          "CREATE TRIGGER fixes_audit_abort BEFORE INSERT ON integration_audit BEGIN SELECT RAISE(ABORT,'FIXES_INJECTED_FAILURE'); END",
        )
        .run()
      try {
        assert.equal(
          (
            await save((c) => {
              c.integrations[0].baseUrl = 'https://other.invalid/api/'
              c.integrations[0].credential = {
                operation: 'replace',
                value: 'SYNTHETIC_ROLLBACK_TOKEN',
              }
            })
          ).code,
          'DATABASE_ERROR',
        )
        assert.equal(await allRows(), before)
      } finally {
        await db.prepare('DROP TRIGGER fixes_audit_abort').run()
      }
      assert.equal(
        (
          await save((c) => {
            c.integrations[0].baseUrl = 'https://other.invalid/api/'
            c.integrations[0].credential = { operation: 'replace', value: 'SYNTHETIC_NEW_TOKEN' }
          })
        ).success,
        true,
      )
      const updated = (await readStoredState(db)).integrations[0].envelope
      assert.equal(await decryptCredential(source, 'sleepy', updated, keys), 'SYNTHETIC_NEW_TOKEN')
      assert.notEqual(updated.ciphertext, envelope.ciphertext)
      assert.equal(
        (
          await save((c) => {
            c.integrations[0].baseUrl = 'https://example.invalid/api/'
            c.integrations[0].credential = { operation: 'clear' }
          })
        ).success,
        true,
      )
      assert.equal((await readConfig(db)).integrations[0].credentialState.configured, false)
    },
  )
  await check(
    'legacy legal rules and encoded special IDs remove private items while public 0% survives',
    async () => {
      await save((c) => {
        const m = c.modules.find((m) => m.id === 'devices')
        m.visibility = 'public'
        m.sources.main = { sourceId: source, subject }
      })
      for (const id of [
        'plain',
        'private.device',
        'a/b~c',
        '@*%2F# 空 格',
        '*',
        '~1',
        'id.name/stateText',
      ]) {
        const rule = id === 'plain' ? 'devices.@plain' : fieldPointer(['devices', '@' + id])
        assert.equal(
          (
            await save(
              (c) =>
                (c.modules.find((m) => m.id === 'devices').fields = {
                  [rule]: policy,
                  'devices.*.stateText': policy,
                }),
            )
          ).success,
          true,
        )
        await store('devices', {
          devices: [device(id), { ...device('public'), name: 'PUBLIC_DEVICE' }],
        })
        const result = await readGuestDashboard(db)
        const wire = JSON.stringify(result)
        assert.ok(!wire.includes('PRIVATE_' + id))
        assert.ok(!wire.includes('PRIVATE_STATE'))
        const data = result.modules.find((m) => m.id === 'devices').snapshot.data
        assert.equal(data.devices.length, 1)
        assert.equal(data.devices[0].batteryPercent, 0)
        report.aclCases.push({ id, rule, privateAbsent: true, publicBattery: 0 })
      }
      assert.equal(
        (
          await save(
            (c) => (c.modules.find((m) => m.id === 'devices').fields = { 'devices.*': policy }),
          )
        ).success,
        true,
      )
      assert.deepEqual(
        (await readGuestDashboard(db)).modules.find((m) => m.id === 'devices').snapshot.data
          .devices,
        [],
      )
    },
  )
  await check(
    'ambiguous old rules, unknown DTO fields and displayName are refused without writes',
    async () => {
      for (const [id, path] of [
        ['devices', 'devices.@private.device'],
        ['devices', 'devices.@private.name'],
        ['quotes', 'items.*.displayName'],
        ['devices', 'devices.*.newSecret'],
        ['services', '/monitors/*/nested/token'],
        ['codex', '/quota/accounts/*/windows/*/resetTime'],
      ]) {
        const before = await allRows()
        assert.equal(
          (await save((c) => (c.modules.find((m) => m.id === id).fields = { [path]: policy })))
            .code,
          'VALIDATION_ERROR',
        )
        assert.equal(await allRows(), before)
      }
      // A future ID is syntactically valid even when no current snapshot contains it.
      assert.equal(
        (
          await save(
            (c) =>
              (c.modules.find((m) => m.id === 'devices').fields = {
                '/devices/@future.device/stateText': policy,
              }),
          )
        ).success,
        true,
      )
      const m = await db
        .prepare("SELECT fields_json FROM dashboard_modules WHERE id='devices'")
        .first()
      await db
        .prepare("UPDATE dashboard_modules SET fields_json=? WHERE id='devices'")
        .bind(JSON.stringify({ 'devices.@private.device': policy }))
        .run()
      await assert.rejects(() => readGuestDashboard(db), /CONFIG_BASELINE_INVALID/)
      await db
        .prepare("UPDATE dashboard_modules SET fields_json=? WHERE id='devices'")
        .bind(m.fields_json)
        .run()
      assert.equal(
        (
          await save(
            (c) => (c.modules.find((m) => m.id === 'quotes').fields = { '/items/*/name': policy }),
          )
        ).success,
        true,
      )
      const quoteData = (await readGuestDashboard(db)).modules.find((m) => m.id === 'quotes')
        .snapshot.data
      assert.ok(quoteData.items.length > 0)
      assert.ok(quoteData.items.every((q) => !Object.hasOwn(q, 'name')))
    },
  )
  await check(
    'nested account/window ACL, private ancestors and module-specific shared views do not leak',
    async () => {
      const priorDevices = JSON.parse(
        (
          await db
            .prepare(
              "SELECT snapshot_json FROM integration_snapshot_views WHERE module_id='devices'",
            )
            .first()
        ).snapshot_json,
      ).data
      assert.equal(
        (
          await save((c) => {
            for (const id of ['codex', 'services']) {
              const m = c.modules.find((m) => m.id === id)
              m.visibility = 'public'
              m.sources.main = { sourceId: source, subject }
            }
            c.modules.find((m) => m.id === 'codex').fields = {
              '/quota/accounts/@private.account': policy,
              '/quota/accounts/@public/windows/@private~1window~0': policy,
              usage: policy,
              estimatedCost: policy,
            }
            c.modules.find((m) => m.id === 'services').fields = {
              '/monitors/@private.monitor': policy,
            }
          })
        ).success,
        true,
      )
      // Changing module references invalidates old collection revisions. Recreate all
      // validated fixtures for the new mapping before testing their independent ACLs.
      await store('devices', priorDevices)
      const account = (id, windows) => ({ id, windows })
      const window = (id) => ({
        id,
        label: 'PRIVATE_WINDOW_LABEL',
        remainingPercent: '50.000',
        resetAt: now,
      })
      await store('codex', {
        usage: { scope: 'PRIVATE_SCOPE', coverageStart: now, days: [] },
        estimatedCost: { currency: 'USD', amount: '1.00', basis: 'PRIVATE_COST' },
        quota: {
          accounts: [
            account('private.account', [window('private-all')]),
            account('public', [
              window('private/window~'),
              { ...window('public'), label: 'PUBLIC_WINDOW' },
            ]),
          ],
        },
        capabilities: {
          usage: { supported: true, verified: true },
          quota: { supported: true, verified: true },
          estimatedCost: { supported: true, verified: true },
        },
      })
      const monitor = (id, state) => ({
        id,
        name: id,
        state,
        latencyMs: 0,
        checkedAt: now,
        statusPageUrl: null,
        uptimePercent: null,
        capabilities: {},
      })
      await store('services', {
        monitors: [monitor('private.monitor', 'down'), monitor('public-monitor', 'up')],
      })
      assert.equal((await db.prepare('SELECT count(*) n FROM integration_snapshots').first()).n, 1)
      assert.equal(
        (await db.prepare('SELECT count(*) n FROM integration_snapshot_views').first()).n,
        3,
      )
      const result = await readGuestDashboard(db),
        wire = JSON.stringify(result)
      for (const marker of [
        'private.account',
        'private/window~',
        'PRIVATE_WINDOW_LABEL',
        'PRIVATE_SCOPE',
        'PRIVATE_COST',
        'private.monitor',
      ])
        assert.ok(!wire.includes(marker), marker)
      assert.ok(wire.includes('PUBLIC_WINDOW'))
      assert.deepEqual(result.summary, { services: { up: 1, down: 0 } })
      assert.ok(result.modules.find((m) => m.id === 'devices').snapshot.data.devices.length)
      const before = await allRows()
      assert.equal(
        (
          await save(
            (c) =>
              (c.modules.find((m) => m.id === 'codex').fields = {
                '/quota/accounts/*': policy,
                '/quota/accounts/@public/windows/*/label': { enabled: true, visibility: 'public' },
              }),
          )
        ).code,
        'VALIDATION_ERROR',
      )
      assert.equal(await allRows(), before)
      // Older per-module updates do not replace a newer sibling or same module.
      const old = await db
        .prepare("SELECT snapshot_json FROM integration_snapshot_views WHERE module_id='devices'")
        .first()
      await store(
        'devices',
        { devices: [device('OLDER_MUST_NOT_WIN')] },
        '2026-10-25T00:00:00.000Z',
      )
      assert.deepEqual(
        await db
          .prepare("SELECT snapshot_json FROM integration_snapshot_views WHERE module_id='devices'")
          .first(),
        old,
      )
    },
  )
  await check(
    'unknown upstream extensions fail closed; login_hint/disabled never expose nested data',
    async () => {
      const row = await db
        .prepare("SELECT snapshot_json FROM integration_snapshot_views WHERE module_id='devices'")
        .first()
      const unknown = JSON.parse(row.snapshot_json)
      unknown.data.devices[0].secretExtension = 'PRIVATE_UNKNOWN_EXTENSION'
      await db
        .prepare("UPDATE integration_snapshot_views SET snapshot_json=? WHERE module_id='devices'")
        .bind(JSON.stringify(unknown))
        .run()
      let result = await readGuestDashboard(db)
      assert.equal(result.modules.find((m) => m.id === 'devices').snapshot.status, 'error')
      assert.ok(!JSON.stringify(result).includes('PRIVATE_UNKNOWN_EXTENSION'))
      await db
        .prepare("UPDATE integration_snapshot_views SET snapshot_json=? WHERE module_id='devices'")
        .bind(row.snapshot_json)
        .run()
      await save((c) => {
        const m = c.modules.find((m) => m.id === 'codex')
        m.visibility = 'admin'
        m.guestBehavior = 'login_hint'
        const s = c.modules.find((m) => m.id === 'services')
        s.enabled = false
      })
      result = await readGuestDashboard(db)
      assert.deepEqual(
        Object.keys(result.modules.find((m) => m.id === 'codex')).sort(),
        ['id', 'title', 'sortOrder', 'kind'].sort(),
      )
      assert.ok(!result.modules.some((m) => m.id === 'services'))
      assert.deepEqual(result.summary, {})
    },
  )
  await check(
    'all business timestamp triggers reject malformed values on insert/update and preserve valid UTC',
    async () => {
      assert.equal(
        (
          await save(
            (c) =>
              (c.integrations[0].credential = {
                operation: 'replace',
                value: 'SYNTHETIC_PERSIST_TOKEN',
              }),
          )
        ).success,
        true,
      )
      await db
        .prepare('INSERT INTO sessions VALUES(?,1,?,?,?,?,NULL)')
        .bind('a'.repeat(64), now, now, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')
        .run()
      await db
        .prepare(
          "INSERT INTO collection_runs(id,source_id,config_version,status,started_at,finished_at,error_code) VALUES('utc-run',?,1,'success',?,?,NULL)",
        )
        .bind(source, now, now)
        .run()
      await db
        .prepare(
          "INSERT INTO daily_usage VALUES(?,'2026-10-26','Asia/Shanghai','USD','utc','1.000000000000000001',?)",
        )
        .bind(source, now)
        .run()
      await db
        .prepare("INSERT INTO import_batches VALUES('utc-import',?,?,'complete',?)")
        .bind(source, 'd'.repeat(64), now)
        .run()
      const columns = {
        site_settings: ['updated_at'],
        integration_audit: ['created_at'],
        integration_snapshots: ['updated_at'],
        integration_snapshot_views: ['updated_at'],
        collection_runs: ['started_at', 'finished_at'],
        daily_usage: ['updated_at'],
        import_batches: ['created_at'],
        sessions: ['created_at', 'last_seen_at', 'expires_at', 'idle_expires_at', 'revoked_at'],
        integrations: ['credential_updated_at'],
      }
      for (const [table, fields] of Object.entries(columns))
        for (const field of fields)
          for (const invalid of [
            'bad',
            '2026-02-30T00:00:00.000Z',
            '2026-10-26T00:00:00Z',
            '2026-10-26T08:00:00.000+08:00',
            '2026-10-26T24:00:00.000Z',
          ]) {
            await assert.rejects(
              () => db.prepare(`UPDATE ${table} SET ${field}=?`).bind(invalid).run(),
              undefined,
              `${table}.${field} ${invalid}`,
            )
          }
      await assert.rejects(() =>
        db
          .prepare(
            "INSERT INTO collection_runs(id,source_id,config_version,status,started_at,finished_at,error_code) VALUES('utc-invalid',?,1,'running',?,NULL,NULL)",
          )
          .bind(source, '2026-02-30T00:00:00.000Z')
          .run(),
      )
      assert.equal(
        (await db.prepare("SELECT amount FROM daily_usage WHERE dimension='utc'").first()).amount,
        '1.000000000000000001',
      )
      assert.equal((await db.prepare('SELECT created_at FROM sessions').first()).created_at, now)
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    },
  )
  await check(
    'new shared views and encrypted metadata survive actual Miniflare dispose/restart',
    async () => {
      const version = (await readConfig(db)).site.configVersion
      await mf.dispose()
      mf = new Miniflare(options)
      db = await mf.getD1Database('DB')
      assert.equal((await readConfig(db)).site.configVersion, version)
      assert.equal(
        (await db.prepare('SELECT count(*) n FROM integration_snapshot_views').first()).n,
        3,
      )
      assert.equal(
        await decryptCredential(
          source,
          'sleepy',
          (await readStoredState(db)).integrations[0].envelope,
          keys,
        ),
        'SYNTHETIC_PERSIST_TOKEN',
      )
      assert.ok((await readGuestDashboard(db)).modules.length)
    },
  )
})
