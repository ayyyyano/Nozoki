import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'

const require = createRequire(import.meta.url)
const wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const output =
  process.env.NOZOKI_TEST_EVIDENCE ?? '.wrangler/test-results/phase-07-ui/default-links-20261029'
await mkdir(output, { recursive: true })
await mkdir('.wrangler/default-links-tests', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/default-links-tests/run-'))
const options = convertV4MiniflareOptions({
  modules: true,
  script: 'export default { fetch() { return new Response(null, {status:404}) } }',
  compatibilityDate: '2026-10-19',
  d1Databases: {
    DB: '00000000-0000-0000-0000-000000000011',
    EDITED: '00000000-0000-0000-0000-000000000012',
    CUSTOM: '00000000-0000-0000-0000-000000000013',
    EMPTY: '00000000-0000-0000-0000-000000000014',
    POPULATED: '00000000-0000-0000-0000-000000000015',
  },
})
options.resourcePersistencePath = persist
const mf = new Miniflare(options)
const report = { runtime: wrangler('miniflare/package.json').version, persist, checks: [] }
const migration = await readFile('migrations/0011_default_site_links.sql', 'utf8')
const statements = (sql, db) => unstable_splitSqlQuery(sql).map((s) => db.prepare(s))
async function legacy(db) {
  // Full ordered history: the resulting baseline must match createDefaultConfig(),
  // which now includes the default yahoo integration seeded by 0013.
  for (const file of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort())
    await db.batch(statements(await readFile('migrations/' + file, 'utf8'), db))
}
async function state(db) {
  return Promise.all(
    [
      'site_settings',
      'dashboard_modules',
      'quote_symbols',
      'integration_audit',
      'config_write_guard',
    ].map(async (table) => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results),
  )
}
test('0011 default links on isolated native workerd D1', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  }
  try {
    const db = await mf.getD1Database('DB')
    await legacy(db)
    await check(
      'fresh initialization replaces the legacy seed and matches all runtime defaults',
      async () => {
        // The ordered history applies 0011 after 0010 (empty-integrations guard holds)
        // and 0013 afterwards (default yahoo source): the baseline matches code defaults.
        const defaults = createDefaultConfig()
        defaults.site.configVersion = 3
        assert.deepEqual(await readConfig(db), defaults)
        assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
      },
    )
    await check(
      'migration replay has no further writes to configuration, version or audit',
      async () => {
        const before = await state(db)
        await db.batch(statements(migration, db))
        assert.deepEqual(await state(db), before)
      },
    )
    await check(
      'CAS remains active after initialization and rejects the second writer',
      async () => {
        const current = await readConfig(db)
        const config = editableConfig(current)
        config.site.siteName = 'Default links CAS check'
        const input = { expectedVersion: current.site.configVersion, config }
        const options = { actor: { kind: 'system', id: 'default-links-test' } }
        const first = await saveConfig(db, input, options)
        const second = await saveConfig(db, input, options)
        assert.equal(first.success, true)
        assert.equal(first.configVersion, current.site.configVersion + 1)
        assert.deepEqual(second, { success: false, code: 'CONFIG_CONFLICT' })
        assert.deepEqual((await readConfig(db)).links, createDefaultConfig().links)
      },
    )
    await check(
      'previously saved configuration is preserved even when some links still use old defaults',
      async () => {
        const edited = await mf.getD1Database('EDITED')
        await legacy(edited)
        const original = await readConfig(edited)
        const config = editableConfig(original)
        config.links[0].url = 'https://custom.example/blog'
        config.links[0].visibility = 'admin'
        assert.equal(
          (
            await saveConfig(
              edited,
              { expectedVersion: original.site.configVersion, config },
              { actor: { kind: 'system', id: 'customization-test' } },
            )
          ).success,
          true,
        )
        const before = await state(edited)
        await edited.batch(statements(migration, edited))
        assert.deepEqual(await state(edited), before)
        assert.equal((await readConfig(edited)).links[1].url, original.links[1].url)
      },
    )
    await check(
      'customized seed at version one is also preserved by the complete-list guard',
      async () => {
        const custom = await mf.getD1Database('CUSTOM')
        await legacy(custom)
        await custom
          .prepare(
            "UPDATE site_settings SET links_json=json_set(links_json,'$[0].title',?) WHERE id=1",
          )
          .bind('Customized initial name')
          .run()
        const before = await state(custom)
        await custom.batch(statements(migration, custom))
        assert.deepEqual(await state(custom), before)
      },
    )
    await check(
      'populated legacy sources at version one preserve the old site configuration',
      async () => {
        const populated = await mf.getD1Database('POPULATED')
        await legacy(populated)
        await populated
          .prepare(
            "INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json) VALUES('legacy-source','sleepy','fixture-v1','https://example.invalid',1,300,'{}','{}')",
          )
          .run()
        const before = await state(populated)
        await populated.batch(statements(migration, populated))
        assert.deepEqual(await state(populated), before)
      },
    )
    await check('missing baseline is not silently initialized', async () => {
      const empty = await mf.getD1Database('EMPTY')
      await legacy(empty)
      await empty.prepare('DELETE FROM site_settings WHERE id=1').run()
      await empty.batch(statements(migration, empty))
      await assert.rejects(() => readConfig(empty), { code: 'CONFIG_NOT_INITIALIZED' })
    })
  } finally {
    await mf.dispose()
    await writeFile(output + '/default-links.json', JSON.stringify(report, null, 2) + '\n')
  }
})
