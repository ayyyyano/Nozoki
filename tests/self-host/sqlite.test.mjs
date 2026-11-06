import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase, assertMigrated } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { importCredentialKey, decryptCredential } from '../../server/services/credentials.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { source, balance } from '../fixtures/adapters.ts'
import { runCollection } from '../../server/collection/run.ts'
import { deepseek } from '../../server/adapters/deepseek.ts'
import { responseTransport } from '../../server/adapters/transport.ts'
import { readGuestDashboard, readAdminDashboard } from '../../server/services/dashboard.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { collectionEnvironment } from '../../server/collection/environment.ts'
import {
  syncCollectionPlans,
  dueCollectionStates,
  claimCollection,
  commitCollection,
} from '../../server/repositories/collection.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'

async function fresh() {
  const directory = await mkdtemp(resolve('.wrangler/self-host-tests-'))
  const path = resolve(directory, 'app.sqlite'),
    db = new SqliteDatabase(path)
  await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))
  return { db, directory, path }
}
const input = (config) => ({
  expectedVersion: config.site.configVersion,
  config: editableConfig(config),
})
async function workers(path, requests) {
  const entries = requests.map((value) => {
    const worker = new Worker(new URL('./cas-worker.mjs', import.meta.url), {
      workerData: { path, ...value },
    })
    const ready = new Promise((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
    return { worker, ready }
  })
  await Promise.all(entries.map((e) => e.ready))
  return Promise.all(
    entries.map(
      ({ worker }) =>
        new Promise((resolve, reject) => {
          worker.once('message', resolve)
          worker.once('error', reject)
          worker.postMessage('start')
        }),
    ),
  )
}
test('SQLite uses all unchanged migrations, defaults, FK and persistent storage', async () => {
  const { db, directory, path } = await fresh()
  const defaults = createDefaultConfig()
  defaults.site.configVersion = 3 // 0016 adds Tailscale; 0019 migrates equivalent source grants through CAS.
  assert.deepEqual(await readConfig(db), defaults)
  assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1)
  assert.equal((await db.prepare('PRAGMA journal_mode').first()).journal_mode, 'wal')
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
  assert.deepEqual(
    (await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))).applied,
    [],
  )
  const v = input(await readConfig(db))
  v.config.site.siteName = 'Persistent self-host'
  assert.equal((await saveConfig(db, v, { actor: { kind: 'system' } })).success, true)
  const blob = new Uint8Array([1, 2, 255])
  await db.prepare('CREATE TABLE binary_test (v BLOB)').run()
  await db.prepare('INSERT INTO binary_test VALUES(?)').bind(blob.buffer).run()
  db.close()
  const reopened = new SqliteDatabase(path)
  try {
    await assertMigrated(reopened, 'migrations')
    assert.equal((await readConfig(reopened)).site.siteName, 'Persistent self-host')
    assert.deepEqual(
      [...(await reopened.prepare('SELECT v FROM binary_test').first()).v],
      [...blob],
    )
  } finally {
    reopened.close()
  }
})
test('SQLite batch rolls back successful early statements after SQL/constraint failure', async () => {
  const { db } = await fresh()
  try {
    const before = await readConfig(db)
    await assert.rejects(
      db.batch([
        db.prepare("UPDATE dashboard_modules SET title='MUST_ROLL_BACK' WHERE id='devices'"),
        db.prepare("UPDATE dashboard_modules SET enabled=2 WHERE id='quotes'"),
      ]),
    )
    assert.deepEqual(await readConfig(db), before)
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO integration_snapshots(source_id,subject,updated_at) VALUES('missing','main','2026-10-30T00:00:00.000Z')",
        )
        .run(),
    )
    assert.equal((await db.prepare('SELECT count(*) AS n FROM config_write_guard').first()).n, 0)
  } finally {
    db.close()
  }
})
test('separate SQLite connections serialize writes and reject one competing CAS save', async () => {
  const { db, path } = await fresh()
  try {
    await db.prepare('CREATE TABLE concurrent_counter(n INTEGER NOT NULL)').run()
    await db.prepare('INSERT INTO concurrent_counter VALUES(0)').run()
    assert.ok(
      (
        await workers(
          path,
          Array.from({ length: 4 }, () => ({ action: 'increments' })),
        )
      ).every((r) => r.success),
    )
    assert.equal((await db.prepare('SELECT n FROM concurrent_counter').first()).n, 100)
    const a = input(await readConfig(db)),
      b = structuredClone(a)
    a.config.site.siteName = 'CAS A'
    b.config.site.siteName = 'CAS B'
    const results = await workers(path, [{ input: a }, { input: b }])
    assert.equal(results.filter((r) => r.success).length, 1)
    assert.equal(results.filter((r) => r.code === 'CONFIG_CONFLICT').length, 1)
    assert.equal((await readConfig(db)).site.configVersion, a.expectedVersion + 1)
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM integration_audit WHERE operation='config_save' AND actor_id IS NULL",
          )
          .first()
      ).n,
      1,
    )
  } finally {
    db.close()
  }
})
test('forward migration backs up existing data and rejects modified or failing migrations', async () => {
  const { db, directory } = await fresh()
  try {
    const folder = resolve(directory, 'migrations')
    await cp('migrations', folder, { recursive: true })
    await writeFile(
      resolve(folder, '9998_test_upgrade.sql'),
      'CREATE TABLE upgrade_test(id INTEGER PRIMARY KEY);',
    )
    const result = await migrateDatabase(db, folder, resolve(directory, 'backups'))
    assert.deepEqual(result.applied, ['9998_test_upgrade.sql'])
    const copy = new SqliteDatabase(result.backupPath)
    try {
      assert.deepEqual(await readConfig(copy), await readConfig(db))
      assert.equal(
        (
          await copy
            .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='upgrade_test'")
            .first()
        ).n,
        0,
      )
    } finally {
      copy.close()
    }
    await writeFile(
      resolve(folder, '9999_test_failure.sql'),
      'CREATE TABLE rolled_back(id INTEGER); INSERT INTO missing_table VALUES(1);',
    )
    await assert.rejects(migrateDatabase(db, folder, resolve(directory, 'backups')))
    assert.equal(
      (await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='rolled_back'").first())
        .n,
      0,
    )
    const first = resolve(folder, '0001_schema.sql')
    await writeFile(first, (await readFile(first, 'utf8')) + '\n-- tampered')
    await assert.rejects(assertMigrated(db, folder), /HISTORY_MISMATCH/)
  } finally {
    db.close()
  }
})
test('credential target guard, encryption, collector and ACL share the real SQLite transaction layer', async () => {
  const { db } = await fresh()
  try {
    const keys = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
    const v = input(await readConfig(db))
    const s = { ...source('deepseek'), id: 'local-balance', baseUrl: 'https://api.deepseek.com/' }
    const { credentialState: _, ...settings } = s
    v.config.integrations = [
      { ...settings, credential: { operation: 'replace', value: 'SYNTHETIC-CREDENTIAL-ONLY' } },
    ]
    v.config.modules.find((m) => m.id === 'quotes').sources = {}
    const module = v.config.modules.find((m) => m.id === 'deepseek')
    module.visibility = 'public'
    module.sources.main = { sourceId: s.id, subject: 'main' }
    module.fields[fieldPointer(['balances', '*', 'granted'])] = {
      enabled: true,
      visibility: 'admin',
    }
    assert.equal((await saveConfig(db, v, { actor: { kind: 'system' }, keys })).success, true)
    const stored = (await readStoredState(db)).integrations[0]
    assert.equal(
      await decryptCredential(s.id, s.provider, stored.envelope, keys),
      'SYNTHETIC-CREDENTIAL-ONLY',
    )
    const wrong = input(await readConfig(db))
    wrong.config.integrations[0].baseUrl = 'https://example.invalid/'
    assert.equal(
      (await saveConfig(db, wrong, { actor: { kind: 'system' }, keys })).code,
      'VALIDATION_ERROR',
    )
    assert.deepEqual((await readStoredState(db)).integrations[0].envelope, stored.envelope)
    const env = { COLLECTOR_EPOCH: '1' }
    const reader = async (p, _env, _signal, now) =>
      deepseek.read({
        source: p.source,
        now,
        transport: responseTransport(p.source, async () => Response.json(balance)),
      })
    const now = Date.now()
    const result = await runCollection(db, env, now, { reader })
    assert.equal(result.success, 1)
    assert.equal(result.fatal, null)
    assert.equal(
      (
        await db
          .prepare('SELECT total FROM balance_observations WHERE currency=?')
          .bind('CNY')
          .first()
      ).total,
      balance.balance_infos[0].total_balance,
    )
    assert.equal(
      (await db.prepare('SELECT count(*) AS n FROM integration_snapshot_views').first()).n,
      1,
    )
    const guest = await readGuestDashboard(db),
      admin = await readAdminDashboard(db)
    assert.ok(!JSON.stringify(guest).includes('"granted":"10.00"'))
    assert.ok(JSON.stringify(admin).includes('"granted":"10.00"'))
    assert.ok(!JSON.stringify(admin).includes('SYNTHETIC-CREDENTIAL'))
    const prior = (await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first())
      .snapshot_json
    // Force due without changing the source or production clock.
    await db
      .prepare(
        "UPDATE collection_state SET next_run_at='1970-01-01T00:00:00.000Z', last_scheduled_at=NULL",
      )
      .run()
    const failure = await runCollection(db, env, now + 1, {
      reader: async () => {
        throw new Error('offline')
      },
    })
    assert.equal(failure.failure, 1)
    assert.equal(
      (await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first())
        .snapshot_json,
      prior,
    )
  } finally {
    db.close()
  }
})
test('SQLite collector fences competing workers, expired leases and changed configuration with cross-table rollback', async () => {
  const { db, path } = await fresh()
  try {
    const v = input(await readConfig(db)),
      s = source('sleepy')
    const { credentialState: _, ...settings } = s
    v.config.integrations = [{ ...settings, credential: { operation: 'keep' } }]
    v.config.modules.find((m) => m.id === 'quotes').sources = {}
    for (const id of ['devices', 'codex'])
      v.config.modules.find((m) => m.id === id).sources.main = { sourceId: s.id, subject: 'main' }
    assert.equal((await saveConfig(db, v, { actor: { kind: 'system' } })).success, true)
    const plan = collectionPlans(await readStoredState(db))[0]
    const environment = await collectionEnvironment(db, { COLLECTOR_EPOCH: '1' })
    const time = Date.now(),
      at = (offset = 0) => new Date(time + offset).toISOString()
    await syncCollectionPlans(db, [plan], environment, at())
    const prior = (await dueCollectionStates(db, at()))[0]
    const claims = await workers(
      path,
      Array.from({ length: 2 }, () => ({ action: 'claim', plan, environment, prior, now: at() })),
    )
    assert.equal(claims.filter(Boolean).length, 1)
    const old = claims.find(Boolean)
    const makeViews = (offset) =>
      ['devices', 'codex'].map((moduleId) => ({
        moduleId,
        subject: 'main',
        snapshot: snapshot('ok', {}, s.id),
        orderAt: at(offset),
        collectedAt: at(offset),
      }))
    const next = await claimCollection(
      db,
      plan,
      environment,
      prior,
      at(61000),
      at(61000),
      'replacement',
    )
    assert.ok(next)
    await assert.rejects(
      commitCollection(db, old, makeViews(61001), [], at(61001), {}),
      /LEASE_LOST/,
    )
    await db
      .prepare(
        "CREATE TRIGGER fail_second_view BEFORE INSERT ON integration_snapshot_views WHEN NEW.module_id='codex' BEGIN SELECT RAISE(ABORT,'INJECTED'); END",
      )
      .run()
    await assert.rejects(
      commitCollection(db, next, makeViews(61002), [], at(61002), {}),
      /INJECTED/,
    )
    for (const table of [
      'integration_snapshots',
      'integration_snapshot_views',
      'collection_commit_guard',
    ])
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0)
    assert.equal(
      (await db.prepare('SELECT status FROM collection_runs WHERE id=?').bind(next.runId).first())
        .status,
      'running',
    )
    await db.prepare('DROP TRIGGER fail_second_view').run()
    await commitCollection(db, next, makeViews(61003), [], at(61003), {})
    assert.equal(
      (await db.prepare('SELECT count(*) AS n FROM integration_snapshot_views').first()).n,
      2,
    )
    const views = (
      await db.prepare('SELECT * FROM integration_snapshot_views ORDER BY module_id').all()
    ).results
    const laterPrior = (await dueCollectionStates(db, at(400000)))[0]
    const later = await claimCollection(
      db,
      plan,
      environment,
      laterPrior,
      at(400000),
      at(400000),
      'later',
    )
    await assert.rejects(
      commitCollection(db, later, makeViews(1), [], at(400001), {}),
      /RESULT_OLDER/,
    )
    const changed = input(await readConfig(db))
    changed.config.integrations[0].baseUrl = 'https://example.invalid/changed/'
    changed.config.integrations[0].credential.operation = 'clear'
    assert.equal((await saveConfig(db, changed, { actor: { kind: 'system' } })).success, true)
    await assert.rejects(
      commitCollection(db, later, makeViews(400002), [], at(400002), {}),
      /SOURCE_CHANGED/,
    )
    assert.deepEqual(
      (await db.prepare('SELECT * FROM integration_snapshot_views ORDER BY module_id').all())
        .results,
      views,
    )
  } finally {
    db.close()
  }
})
