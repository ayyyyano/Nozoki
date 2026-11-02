import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig } from '../../server/services/config.ts'
import {
  encryptCredential,
  importCredentialKey,
  decryptCredential,
} from '../../server/services/credentials.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')

// Historical migrations are seeded through their SQL schema. Current config services require 0016.
test('default Tencent loads automatically into saved sites with CAS, audit and rollback protection', async (t) => {
  const options = convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-10-19',
    d1Databases: {
      UPGRADE: 'tencent-upgrade',
      CUSTOM: 'custom-tencent',
      FULL: 'full-source-list',
      FAIL: 'failed-tencent-insert',
    },
  })
  options.resourcePersistencePath = await mkdtemp(resolve('.wrangler/tencent-default-load-'))
  const mf = new Miniflare(options),
    ring = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
  const execute = (db, sql) => db.batch(unstable_splitSqlQuery(sql).map((s) => db.prepare(s)))
  const sql = await readFile('migrations/0015_load_default_tencent_source.sql', 'utf8')
  const state = async (db) =>
    Promise.all(
      [
        'site_settings',
        'dashboard_modules',
        'quote_symbols',
        'integrations',
        'integration_audit',
        'collection_state',
        'config_write_guard',
      ].map(
        async (table) => (await db.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all()).results,
      ),
    )
  try {
    for (const name of ['UPGRADE', 'CUSTOM', 'FULL', 'FAIL'])
      await t.test(name, async () => {
        const db = await mf.getD1Database(name)
        for (const f of (await readdir('migrations'))
          .filter((f) => f.endsWith('.sql') && f < '0014')
          .sort())
          await execute(db, await readFile('migrations/' + f, 'utf8'))
        await db.batch([
          db.prepare(
            "INSERT INTO config_write_guard(id,token,expected_version) VALUES(1,'fixture',1)",
          ),
          db.prepare(
            "UPDATE site_settings SET config_version=2,write_token='fixture',settings_json=json_set(settings_json,'$.siteName','Saved user site')",
          ),
          db.prepare("DELETE FROM config_write_guard WHERE token='fixture'"),
          db.prepare("UPDATE quote_symbols SET display_name='My ETF label' WHERE symbol='QQQM'"),
          db.prepare(
            "UPDATE integrations SET base_url='https://query2.finance.yahoo.com/' WHERE id='yahoo'",
          ),
        ])
        const extra = (id) =>
          db
            .prepare(
              "INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json) VALUES(?,'sleepy','sleepy-v5-status',NULL,0,300,'{}','{}')",
            )
            .bind(id)
            .run()
        if (name === 'CUSTOM') await extra('tencent')
        if (name === 'FULL') for (let n = 0; n < 9; n++) await extra('custom-' + n)
        let envelope
        if (name === 'UPGRADE') {
          envelope = await encryptCredential(
            'yahoo',
            'quotes-custom',
            'SYNTHETIC_KEY',
            ring,
            '2026-11-02T00:00:00.000Z',
          )
          await db
            .prepare(
              "UPDATE integrations SET credential_ciphertext=?,credential_iv=?,credential_key_version=?,credential_algorithm=?,credential_updated_at=? WHERE id='yahoo'",
            )
            .bind(
              envelope.ciphertext,
              envelope.iv,
              envelope.keyVersion,
              envelope.algorithm,
              envelope.updatedAt,
            )
            .run()
          await db
            .prepare(
              "INSERT INTO collection_state(source_id,source_revision,environment_epoch,next_run_at,retry_after_until,status,error_code,failures) SELECT id,collection_generation||':'||collection_revision,1,'2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','error','RATE_LIMITED',7 FROM integrations WHERE id='yahoo'",
            )
            .run()
        }
        const before = await state(db)
        if (name === 'FAIL') {
          await db
            .prepare(
              "CREATE TRIGGER fail_tencent BEFORE INSERT ON integrations WHEN NEW.id='tencent' BEGIN SELECT RAISE(ABORT,'INJECTED_FAILURE'); END",
            )
            .run()
          await assert.rejects(execute(db, sql), /INJECTED_FAILURE/)
          assert.deepEqual(await state(db), before)
        } else {
          await execute(db, sql)
          if (name === 'UPGRADE') {
            assert.equal(
              (await db.prepare('SELECT config_version FROM site_settings').first()).config_version,
              3,
            )
            const source = await db.prepare("SELECT * FROM integrations WHERE id='tencent'").first()
            assert.equal(source.protocol_version, 'tencent-us-v1')
            assert.equal(source.enabled, 1)
            const old = await db.prepare("SELECT * FROM integrations WHERE id='yahoo'").first()
            assert.equal(old.enabled, 0)
            assert.equal(old.credential_ciphertext, envelope.ciphertext)
            assert.equal(
              await decryptCredential('yahoo', 'quotes-custom', envelope, ring),
              'SYNTHETIC_KEY',
            )
            assert.deepEqual(
              (await db.prepare('SELECT * FROM collection_state ORDER BY 1').all()).results,
              before[5],
            )
            const quotes = (await db.prepare('SELECT * FROM quote_symbols').all()).results
            assert.ok(quotes.every((q) => q.provider === 'tencent'))
            assert.equal(quotes.find((q) => q.symbol === 'QQQM').display_name, 'My ETF label')
            const audit = await db
              .prepare("SELECT * FROM integration_audit WHERE id='default-tencent-source-v1'")
              .first()
            assert.equal(audit.actor_kind, 'system')
            assert.equal(audit.config_version, 3)
            await assert.rejects(
              db.prepare("INSERT INTO config_write_guard VALUES(1,'old',2)").run(),
              /NOZOKI_CONFIG_CONFLICT/,
            )
            const after = await state(db)
            await execute(db, sql)
            assert.deepEqual(await state(db), after)
          } else assert.deepEqual(await state(db), before)
        }
        await execute(db, await readFile('migrations/0016_tailscale_module.sql', 'utf8'))
        const current = await readConfig(db)
        assert.equal(current.site.siteName, 'Saved user site')
        assert.equal(current.modules.find((m) => m.id === 'tailscale').enabled, false)
        assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
      })
  } finally {
    await mf.dispose()
  }
})
