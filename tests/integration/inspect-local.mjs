import { createRequire } from 'node:module'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
await mkdir('.wrangler/test-results/phase-02', { recursive: true })
const require = createRequire(import.meta.url),
  { getPlatformProxy } = require('wrangler')
const p = await getPlatformProxy({
  configPath: resolve('wrangler.jsonc'),
  persist: { path: resolve('.wrangler/state/v3') },
  remoteBindings: false,
})
try {
  const db = p.env.DB,
    tables = {}
  for (const name of [
    'site_settings',
    'dashboard_modules',
    'quote_symbols',
    'integrations',
    'sessions',
    'login_limits',
    'integration_audit',
    'integration_snapshots',
    'collection_runs',
    'daily_usage',
    'import_batches',
    'config_write_guard',
  ]) {
    tables[name] = {
      columns: (await db.prepare(`PRAGMA table_info(${name})`).all()).results,
      indexes: (await db.prepare(`PRAGMA index_list(${name})`).all()).results,
      foreignKeys: (await db.prepare(`PRAGMA foreign_key_list(${name})`).all()).results,
      count: (await db.prepare(`SELECT count(*) AS n FROM ${name}`).first()).n,
    }
  }
  const report = {
    tables,
    migrations: (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results,
    foreignKeyCheck: (await db.prepare('PRAGMA foreign_key_check').all()).results,
    triggerNames: (
      await db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()
    ).results,
    usageIndexPlan: (
      await db
        .prepare('EXPLAIN QUERY PLAN SELECT * FROM daily_usage WHERE day<?')
        .bind('2025-01-01')
        .all()
    ).results,
  }
  await writeFile('.wrangler/test-results/phase-02/schema.json', JSON.stringify(report, null, 2))
  console.log(
    `Inspected ${Object.keys(tables).length} application tables and ${report.triggerNames.length} triggers`,
  )
} finally {
  await p.dispose()
}
