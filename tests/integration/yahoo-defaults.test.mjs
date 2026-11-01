import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'

const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')

test('fresh D1 collects bound default quotes without a public route or secret; disabling stops requests', async () => {
  const fixture = JSON.parse(await readFile('tests/fixtures/yahoo-chart.json', 'utf8'))
  const script = (
    await build({
      entryPoints: ['tests/integration/yahoo-chart-worker.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:workers'],
    })
  ).outputFiles[0].text
  let requests = 0
  const options = convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-10-19',
    d1Databases: { DB: 'default-yahoo-isolated' },
    bindings: { COLLECTOR_EPOCH: '1' },
    outboundService: async (request) => {
      requests++
      const url = new URL(request.url)
      assert.equal(url.origin, 'https://query1.finance.yahoo.com')
      assert.equal(url.search, '?range=5d&interval=1d')
      assert.equal(request.headers.get('authorization'), null)
      assert.equal(request.headers.get('cookie'), null)
      const symbol = url.pathname.split('/').at(-1)
      assert.ok(['QQQM', 'VOO'].includes(symbol))
      return Response.json(fixture.responses[symbol])
    },
  })
  options.resourcePersistencePath = await mkdtemp(resolve('.wrangler/default-yahoo-tests-'))
  const mf = new Miniflare(options)
  try {
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    assert.deepEqual(await readConfig(db), createDefaultConfig())
    // Like 0011, the backfill migration leaves no audit row on an untouched baseline.
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM integration_audit WHERE id='default-yahoo-v1'")
          .first()
      ).n,
      0,
    )
    const call = async (path) => (await mf.dispatchFetch('http://local.test' + path)).json()
    const result = await call('/collect')
    assert.equal(result.success, 1)
    assert.equal(result.requests, 2)
    const dashboard = await call('/api/dashboard')
    assert.deepEqual(
      dashboard.modules.find((m) => m.id === 'quotes').snapshot.data.items.map((q) => q.symbol),
      ['QQQM', 'VOO'],
    )
    assert.equal(requests, 2)
    const current = await readConfig(db),
      config = editableConfig(current)
    config.integrations[0].enabled = false
    assert.equal(
      (
        await saveConfig(
          db,
          { expectedVersion: current.site.configVersion, config },
          { actor: { kind: 'system' } },
        )
      ).success,
      true,
    )
    assert.equal((await call('/collect')).selected, 0)
    assert.equal(requests, 2)
  } finally {
    await mf.dispose()
  }
})
