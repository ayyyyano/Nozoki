import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import {
  encryptCredential,
  importCredentialKey,
  decryptCredential,
} from '../../server/services/credentials.ts'

const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')

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
  const mf = new Miniflare(options)
  const sql = await readFile('migrations/0015_load_default_tencent_source.sql', 'utf8')
  const apply = (db) => db.batch(unstable_splitSqlQuery(sql).map((s) => db.prepare(s)))
  const ring = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
  try {
    for (const name of ['UPGRADE', 'CUSTOM', 'FULL', 'FAIL'])
      await t.test(name, async () => {
        const db = await mf.getD1Database(name)
        for (const file of (await readdir('migrations'))
          .filter((f) => f.endsWith('.sql') && f < '0014')
          .sort())
          await db.batch(
            unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((s) =>
              db.prepare(s),
            ),
          )
        const initial = await readConfig(db),
          config = editableConfig(initial)
        config.site.siteName = 'Saved user site'
        config.quotes[0].displayName = 'My ETF label'
        config.integrations[0].baseUrl = 'https://query2.finance.yahoo.com/'
        const extra = (id) => ({
          id,
          provider: 'sleepy',
          protocolVersion: 'sleepy-v5-status',
          baseUrl: null,
          enabled: false,
          refreshInterval: 300,
          fieldMappings: {},
          capabilities: {},
          credential: { operation: 'keep' },
        })
        if (name === 'CUSTOM') config.integrations.push(extra('tencent'))
        if (name === 'FULL')
          for (let n = 0; n < 9; n++) config.integrations.push(extra('custom-' + n))
        assert.equal(
          (
            await saveConfig(
              db,
              { expectedVersion: initial.site.configVersion, config },
              { actor: { kind: 'system' } },
            )
          ).success,
          true,
        )
        const before = await readConfig(db)
        if (name === 'UPGRADE') {
          const envelope = await encryptCredential(
            'yahoo',
            'quotes-custom',
            'SYNTHETIC_KEY',
            ring,
            '2026-11-02T00:00:00.000Z',
          )
          await db
            .prepare(
              'UPDATE integrations SET credential_ciphertext=?,credential_iv=?,credential_key_version=?,credential_algorithm=?,credential_updated_at=? WHERE id=?',
            )
            .bind(
              envelope.ciphertext,
              envelope.iv,
              envelope.keyVersion,
              envelope.algorithm,
              envelope.updatedAt,
              'yahoo',
            )
            .run()
          await db
            .prepare(
              "INSERT INTO collection_state(source_id,source_revision,environment_epoch,next_run_at,retry_after_until,status,error_code,failures) SELECT id,collection_generation||':'||collection_revision,1,'2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','error','RATE_LIMITED',7 FROM integrations WHERE id='yahoo'",
            )
            .run()
          const previous = await db
            .prepare("SELECT * FROM collection_state WHERE source_id='yahoo'")
            .first()
          await apply(db)
          const after = await readConfig(db),
            source = after.integrations.find((s) => s.id === 'tencent')
          assert.equal(source.protocolVersion, 'tencent-us-v1')
          assert.equal(source.baseUrl, 'https://web.ifzq.gtimg.cn/')
          assert.equal(source.enabled, true)
          assert.equal(source.credentialState.configured, false)
          assert.ok(after.quotes.every((q) => q.provider === 'tencent'))
          assert.equal(after.quotes[0].displayName, before.quotes[0].displayName)
          assert.equal(
            after.modules.find((m) => m.id === 'quotes').sources.main.sourceId,
            'tencent',
          )
          assert.equal(after.site.siteName, before.site.siteName)
          assert.equal(after.site.configVersion, before.site.configVersion + 1)
          assert.equal(after.integrations.find((s) => s.id === 'yahoo').enabled, false)
          const old = await db.prepare("SELECT * FROM integrations WHERE id='yahoo'").first()
          assert.equal(old.credential_ciphertext, envelope.ciphertext)
          assert.equal(
            await decryptCredential(
              'yahoo',
              'quotes-custom',
              {
                ciphertext: old.credential_ciphertext,
                iv: old.credential_iv,
                keyVersion: old.credential_key_version,
                algorithm: old.credential_algorithm,
                updatedAt: old.credential_updated_at,
              },
              ring,
            ),
            'SYNTHETIC_KEY',
          )
          assert.deepEqual(
            await db.prepare("SELECT * FROM collection_state WHERE source_id='yahoo'").first(),
            previous,
          )
          assert.equal(
            await db.prepare("SELECT * FROM collection_state WHERE source_id='tencent'").first(),
            null,
          )
          const audit = await db
            .prepare("SELECT * FROM integration_audit WHERE id='default-tencent-source-v1'")
            .first()
          assert.equal(audit.actor_kind, 'system')
          assert.equal(audit.config_version, after.site.configVersion)
          assert.deepEqual(
            await saveConfig(
              db,
              { expectedVersion: before.site.configVersion, config: editableConfig(before) },
              { actor: { kind: 'system' } },
            ),
            { success: false, code: 'CONFIG_CONFLICT' },
          )
          await apply(db)
          assert.deepEqual(await readConfig(db), after)
        } else if (name === 'FAIL') {
          await db
            .prepare(
              "CREATE TRIGGER fail_tencent BEFORE INSERT ON integrations WHEN NEW.id='tencent' BEGIN SELECT RAISE(ABORT,'INJECTED_FAILURE'); END",
            )
            .run()
          await assert.rejects(apply(db))
          assert.deepEqual(await readConfig(db), before)
          assert.equal((await db.prepare('SELECT count(*) n FROM config_write_guard').first()).n, 0)
          assert.equal(
            (
              await db
                .prepare(
                  "SELECT count(*) n FROM integration_audit WHERE id='default-tencent-source-v1'",
                )
                .first()
            ).n,
            0,
          )
        } else {
          await apply(db)
          assert.deepEqual(await readConfig(db), before)
        }
        assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
      })
  } finally {
    await mf.dispose()
  }
})
