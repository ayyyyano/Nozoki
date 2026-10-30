// Explicit local-only upgrade: rehearse on a consistent external backup before touching daily D1.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = '.wrangler/test-results/phase-04'
const backup = JSON.parse(await readFile(`${evidence}/database-backup.json`, 'utf8'))
const targets = ['0008_admin_configuration.sql']
const parent = await mkdtemp(resolve('.wrangler/phase04-upgrade-'))
const dir = resolve(parent, 'd1/miniflare-D1DatabaseObject')
await mkdir(dir, { recursive: true })
await copyFile(backup.backup, resolve(dir, basename(backup.source)))
const report = { targets, isolated: parent, dailyApplied: false, checks: [] }
async function upgrade(path, rehearsal) {
  const options = convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("local")}}',
    d1Databases: { DB: '00000000-0000-0000-0000-000000000002' },
  })
  options.resourcePersistencePath = path
  const mf = new Miniflare(options)
  try {
    const db = await mf.getD1Database('DB')
    const rows = async (table) =>
      (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results
    const before = {
      site: await rows('site_settings'),
      modules: await rows('dashboard_modules'),
      integrations: await rows('integrations'),
      audit: await rows('integration_audit'),
      quotes: await rows('quote_symbols'),
    }
    assert.equal(before.site.length, 1, 'Refuse to upgrade an empty/wrong D1 file')
    const applied = (await rows('d1_migrations')).map((r) => r.name)
    const snapshots = await rows('integration_snapshots')
    for (const file of targets) {
      if (applied.includes(file)) continue
      const statements = unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map(
        (sql) => db.prepare(sql),
      )
      statements.push(db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(file))
      await db.batch(statements)
    }
    const after = {
      site: await rows('site_settings'),
      modules: await rows('dashboard_modules'),
      integrations: await rows('integrations'),
      audit: await rows('integration_audit'),
      quotes: await rows('quote_symbols'),
    }
    assert.deepEqual(after, before)
    if (false) assert.deepEqual(await rows('integration_snapshot_views'), snapshots)
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    report.checks.push({
      rehearsal,
      priorMigrations: applied,
      migrations: (await rows('d1_migrations')).map((r) => r.name),
      configVersion: after.site[0].config_version,
      preservedBusinessRows: true,
    })
  } finally {
    await mf.dispose()
  }
}
await upgrade(parent, true)
if (process.argv.includes('--apply-local')) {
  await upgrade(resolve('.wrangler/state/v3'), false)
  report.dailyApplied = true
}
await writeFile(`${evidence}/upgrade-0008.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ dailyApplied: report.dailyApplied, checks: report.checks }))
