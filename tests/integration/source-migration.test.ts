// Isolated D1 with synthetic encrypted bytes, never the daily database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve('wrangler/package.json'),
)('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
test('native D1 migration preserves credentials/grants, refuses stale CAS and rolls back on audit failure', async () => {
  const options = convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("fixture")}}',
    compatibilityDate: '2026-10-19',
    d1Databases: { DB: 'migration-fixture', FAIL: 'rollback-fixture' },
  })
  options.resourcePersistencePath = await mkdtemp(resolve('.wrangler/public-migration-d1-'))
  const mf = new Miniflare(options)
  try {
    const apply = (db, sql) => db.batch(unstable_splitSqlQuery(sql).map((s) => db.prepare(s)))
    const migration = await readFile('migrations/0019_public_sources.sql', 'utf8')
    for (const name of ['DB', 'FAIL']) {
      const db = await mf.getD1Database(name)
      for (const file of (await readdir('migrations'))
        .filter((f) => f.endsWith('.sql') && f < '0019')
        .sort())
        await apply(db, await readFile('migrations/' + file, 'utf8'))
      await db
        .prepare(
          "INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json,credential_ciphertext,credential_iv,credential_key_version,credential_algorithm,credential_updated_at) VALUES('fixture','deepseek','deepseek-balance-v1','https://api.deepseek.com/',1,300,'{}','{}','QUFBQUFBQUFBQUFBQUFBQUFB','QUFBQUFBQUFBQUFB','v1','AES-GCM','2026-11-06T00:00:00.000Z')",
        )
        .run()
      const before = await db.prepare("SELECT * FROM integrations WHERE id='fixture'").first()
      const version = (await db.prepare('SELECT config_version v FROM site_settings').first()).v
      if (name === 'FAIL') {
        await db
          .prepare(
            "CREATE TRIGGER reject_fixture BEFORE INSERT ON integration_audit WHEN NEW.id='migration-0019-public-sources' BEGIN SELECT RAISE(ABORT,'INJECTED'); END",
          )
          .run()
        await assert.rejects(apply(db, migration), /INJECTED/)
        assert.deepEqual(
          await db.prepare("SELECT * FROM integrations WHERE id='fixture'").first(),
          before,
        )
        assert.equal(
          (
            await db
              .prepare("SELECT count(*) n FROM sqlite_master WHERE name='source_access_migrations'")
              .first()
          ).n,
          0,
        )
      } else {
        await apply(db, migration)
        const after = await db.prepare("SELECT * FROM integrations WHERE id='fixture'").first()
        assert.equal(after.credential_ciphertext, before.credential_ciphertext)
        assert.equal(after.credential_iv, before.credential_iv)
        assert.equal(after.collection_revision, before.collection_revision + 1)
        const access = JSON.parse(after.access_json)
        assert.equal(access.approved, true)
        assert.equal(
          access.approvedTarget,
          sourceTargetKey(
            {
              id: after.id,
              provider: after.provider,
              protocolVersion: after.protocol_version,
              baseUrl: after.base_url,
            },
            access,
          ),
        )
        assert.equal(
          (await db.prepare('SELECT config_version v FROM site_settings').first()).v,
          version + 1,
        )
        await assert.rejects(
          db
            .prepare('INSERT INTO config_write_guard VALUES(1,?,?)')
            .bind('stale-fixture', version)
            .run(),
          /NOZOKI_CONFIG_CONFLICT/,
        )
      }
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    }
  } finally {
    await mf.dispose()
  }
})
