// Isolated pre/post security regression probe. No daily database or HTTP write route.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { readGuestDashboard } from '../../server/services/dashboard.ts'
import { importCredentialKey } from '../../server/services/credentials.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
const require = createRequire(import.meta.url)
const wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = '.wrangler/test-results/phase-02-fixes'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase02-fixes', { recursive: true })
const persist = resolve(await mkdtemp('.wrangler/phase02-fixes/repro-'))
const options = convertV4MiniflareOptions({
  modules: true,
  script: 'export default {fetch(){return new Response("isolated")}}',
  d1Databases: { DB: '00000000-0000-0000-0000-000000000002' },
})
options.resourcePersistencePath = persist
const mf = new Miniflare(options)
const results = {
  runtime: wrangler('miniflare/package.json').version,
  persist,
  mode: process.env.REPRO_MODE ?? 'before',
  checks: [],
}
try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  const keys = await importCredentialKey('repro', crypto.getRandomValues(new Uint8Array(32)))
  const actor = { kind: 'system', id: 'fixes-repro' }
  const input = async () => {
    const c = await readConfig(db)
    return {
      expectedVersion: c.site.configVersion,
      config: {
        ...c,
        integrations: c.integrations.map(({ credentialState, ...i }) => ({
          ...i,
          credential: { operation: 'keep' },
        })),
      },
    }
  }
  const v = await input()
  v.config.integrations.push({
    id: 'repro',
    provider: 'sleepy',
    protocolVersion: 'test',
    baseUrl: 'https://old.example.invalid/api/',
    enabled: true,
    refreshInterval: 300,
    fieldMappings: {},
    capabilities: {},
    credential: { operation: 'replace', value: 'SYNTHETIC_REPRO_TOKEN' },
  })
  assert.equal((await saveConfig(db, v, { actor, keys })).success, true)
  const before = JSON.stringify((await db.prepare('SELECT * FROM integrations').all()).results)
  const changed = await input()
  changed.config.integrations[0].baseUrl = 'https://new.example.invalid/api/'
  const saved = await saveConfig(db, changed, { actor, keys })
  const unchanged =
    before === JSON.stringify((await db.prepare('SELECT * FROM integrations').all()).results)
  results.checks.push({
    finding: 'F-01',
    expected: 'reject and preserve database',
    actual: saved,
    unchanged,
  })
  assert.equal(saved.success, results.mode === 'before')
  const acl = await input(),
    devices = acl.config.modules.find((m) => m.id === 'devices')
  devices.visibility = 'public'
  devices.sources.main = { sourceId: 'repro', subject: 'devices' }
  devices.fields = {
    [results.mode === 'before' ? 'devices.@private.device' : '/devices/@private.device']: {
      enabled: true,
      visibility: 'admin',
    },
  }
  assert.equal((await saveConfig(db, acl, { actor })).success, true)
  await upsertSnapshot(db, {
    sourceId: 'repro',
    subject: 'devices',
    moduleId: 'devices',
    updatedAt: '2026-10-26T10:00:00.000Z',
    snapshot: snapshot(
      'ok',
      {
        devices: [
          {
            id: 'private.device',
            name: 'PRIVATE_REPRO_NAME',
            using: true,
            stateText: null,
            online: true,
            batteryPercent: 0,
            charging: false,
            observedAt: null,
            heartbeatAt: null,
            capabilities: {},
          },
        ],
      },
      'repro',
    ),
  })
  const wire = JSON.stringify(await readGuestDashboard(db))
  results.checks.push({
    finding: 'F-02',
    expected: 'private item absent',
    privateValueVisible: wire.includes('PRIVATE_REPRO_NAME'),
  })
  assert.equal(wire.includes('PRIVATE_REPRO_NAME'), results.mode === 'before')
  const q = await input(),
    quotes = q.config.modules.find((m) => m.id === 'quotes')
  quotes.fields = { 'items.*.displayName': { enabled: true, visibility: 'admin' } }
  const invalid = await saveConfig(db, q, { actor })
  results.checks.push({
    finding: 'F-02-field-name',
    expected: 'reject non DTO field displayName',
    actual: invalid,
  })
  assert.equal(invalid.success, results.mode === 'before')
} finally {
  await mf.dispose()
  await writeFile(`${evidence}/repro-${results.mode}.json`, JSON.stringify(results, null, 2))
}
