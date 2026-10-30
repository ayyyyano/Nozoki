// An explicit maintenance command, not a prebuild hook: migrations are never rewritten on build.
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const out = 'node_modules/.cache/nozoki-defaults.mjs'
await mkdir('node_modules/.cache', { recursive: true })
await build({
  stdin: {
    contents: "export { createDefaultConfig } from './shared/contracts/config.ts'",
    resolveDir: process.cwd(),
  },
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
})
const { createDefaultConfig } = await import(pathToFileURL(`${process.cwd()}/${out}`).href)
const c = createDefaultConfig(),
  { configVersion, ...site } = c.site
const sql = (v) =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`
const row = (table, columns, values) =>
  `INSERT INTO ${table}(${columns}) VALUES(${values.map(sql).join(',')});`
const now = '2026-10-26T00:00:00.000Z'
const lines = [
  '-- Versioned minimum defaults; subsequent initialization skips this applied migration.',
  row('site_settings', 'id,config_version,settings_json,links_json,updated_at', [
    1,
    configVersion,
    JSON.stringify(site),
    JSON.stringify(c.links),
    now,
  ]),
]
for (const m of c.modules)
  lines.push(
    row(
      'dashboard_modules',
      'id,enabled,title,sort_order,visibility,guest_behavior,fields_json,sources_json',
      [
        m.id,
        Number(m.enabled),
        m.title,
        m.sortOrder,
        m.visibility,
        m.guestBehavior,
        JSON.stringify(m.fields),
        JSON.stringify(m.sources),
      ],
    ),
  )
for (const q of c.quotes)
  lines.push(
    row(
      'quote_symbols',
      'id,market,symbol,display_name,provider,sort_order,enabled,refresh_interval',
      [
        JSON.stringify([q.market, q.symbol, q.provider]),
        q.market,
        q.symbol,
        q.displayName,
        q.provider,
        q.sortOrder,
        Number(q.enabled),
        q.refreshInterval,
      ],
    ),
  )
lines.push(
  row(
    'integration_audit',
    'id,operation,config_version,changed_fields_json,actor_kind,actor_id,result,created_at',
    [
      'initial-configuration-v1',
      'config_initialize',
      1,
      '["site","modules","quotes","links"]',
      'system',
      'migration-0002',
      'success',
      now,
    ],
  ),
)
await writeFile('migrations/0002_default_configuration.sql', lines.join('\n') + '\n', {
  flag: 'wx',
})
