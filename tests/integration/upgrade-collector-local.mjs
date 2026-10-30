// Explicit local upgrade only, after backup rehearsal. Never uses Cloudflare remote APIs.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
if (!process.env.NOZOKI_TEST_MINIFLARE) throw new Error('Use the documented isolated local runtime')
const { Miniflare, convertV4MiniflareOptions } = require(
    resolve(process.env.NOZOKI_TEST_MINIFLARE),
  ),
  { unstable_splitSqlQuery } = require('wrangler')
const evidence = '.wrangler/test-results/phase-06',
  backup = JSON.parse(await readFile(evidence + '/database-backup.json', 'utf8'))
const bytes = await readFile(backup.backup)
assert.equal(createHash('sha256').update(bytes).digest('hex'), backup.sha256)
const parent = await mkdtemp(resolve('.wrangler/phase06-upgrade-')),
  directory = resolve(parent, 'd1/miniflare-D1DatabaseObject')
await mkdir(directory, { recursive: true })
await copyFile(backup.backup, resolve(directory, basename(backup.source)))
const report = {
  migration: '0010_collection.sql',
  isolated: parent,
  dailyApplied: false,
  checks: [],
}
async function upgrade(path, rehearsal) {
  const opts = convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("local")}}',
    d1Databases: { DB: '00000000-0000-0000-0000-000000000002' },
  })
  opts.resourcePersistencePath = path
  const mf = new Miniflare(opts)
  try {
    const db = await mf.getD1Database('DB'),
      before = {},
      columns = {}
    for (const name of Object.keys(backup.tables)) {
      const rows = (await db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()).results
      columns[name] = (await db.prepare('PRAGMA table_info("' + name + '")').all()).results.map(
        (r) => r.name,
      )
      before[name] = rows
    }
    assert.equal(before.site_settings.length, 1)
    if (!rehearsal) {
      for (const [table, old] of Object.entries(report.rehearsalRows))
        assert.ok(
          JSON.stringify(before[table]) === JSON.stringify(old),
          'Daily database changed since the backup: ' + table,
        )
    }
    const prior = before.d1_migrations.map((r) => r.name)
    assert.ok(prior.includes('0009_adapter_test_slots.sql'))
    if (!prior.includes(report.migration))
      await db.batch([
        ...unstable_splitSqlQuery(await readFile('migrations/' + report.migration, 'utf8')).map(
          (sql) => db.prepare(sql),
        ),
        db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(report.migration),
      ])
    for (const table of Object.keys(before)) {
      if (table === 'd1_migrations') continue
      const after = (
        await db
          .prepare(
            'SELECT ' +
              columns[table].map((c) => '"' + c + '"').join(',') +
              ' FROM "' +
              table +
              '" ORDER BY rowid',
          )
          .all()
      ).results
      assert.ok(
        JSON.stringify(after) === JSON.stringify(before[table]),
        'Changed old columns in ' + table,
      )
    }
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    report.checks.push({
      rehearsal,
      originalColumnsAndRowsPreserved: true,
      configVersion: before.site_settings[0].config_version,
      migrations: (
        await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()
      ).results.map((r) => r.name),
    })
    if (rehearsal) report.rehearsalRows = before
  } finally {
    await mf.dispose()
  }
  // D1 deliberately rejects integrity_check. Read the closed SQLite file directly.
  const integrity = execFileSync(
    'python',
    [
      '-c',
      'import sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"; assert not c.execute("PRAGMA foreign_key_check").fetchall(); print("ok")',
      resolve(path, 'd1/miniflare-D1DatabaseObject', basename(backup.source)),
    ],
    { encoding: 'utf8' },
  ).trim()
  assert.equal(integrity, 'ok')
  report.checks.at(-1).integrity = integrity
}
try {
  await upgrade(parent, true)
  if (process.argv.includes('--apply-local')) {
    await upgrade(resolve('.wrangler/state/v3'), false)
    report.dailyApplied = true
  }
} finally {
  delete report.rehearsalRows
  await writeFile(evidence + '/upgrade-0010.json', JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
