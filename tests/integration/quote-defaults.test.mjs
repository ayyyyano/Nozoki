import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { tencentFixtures } from '../fixtures/tencent-quotes.ts'
import {
  encryptCredential,
  importCredentialKey,
  decryptCredential,
} from '../../server/services/credentials.ts'

const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')

test('fresh D1 collects bound default quotes without a public route or secret; disabling stops requests', async () => {
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
  let requests = 0,
    failure = false
  const options = convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-10-19',
    d1Databases: { DB: 'default-yahoo-isolated' },
    bindings: { COLLECTOR_EPOCH: '1' },
    outboundService: async (request) => {
      requests++
      if (failure)
        return new Response('private upstream failure', {
          status: 429,
          headers: { 'Retry-After': '3600' },
        })
      const url = new URL(request.url)
      assert.equal(url.origin, 'https://web.ifzq.gtimg.cn')
      assert.equal(url.pathname, '/appstock/app/usfqkline/get')
      assert.equal(request.headers.get('authorization'), null)
      assert.equal(request.headers.get('cookie'), null)
      const param = url.searchParams.get('param')
      assert.ok(['usQQQM.OQ,day,,,5,qfq', 'usVOO.AM,day,,,5,qfq'].includes(param))
      return new Response(JSON.stringify(tencentFixtures[param.split(',')[0].slice(2)]), {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      })
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
    const stored = (
      await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first()
    ).snapshot_json
    assert.equal(JSON.parse(stored).data.items[0].price, '284.34')
    assert.equal(JSON.parse(stored).data.items[0].history.length, 5)
    assert.equal(JSON.stringify(dashboard).includes('web.ifzq.gtimg.cn'), false)
    assert.equal((await call('/api/dashboard')).viewer, 'guest')
    assert.equal(requests, 2, 'Dashboard reads do not request Tencent')
    failure = true
    await db
      .prepare(
        "UPDATE collection_state SET next_run_at='1970-01-01T00:00:00.000Z',last_scheduled_at=NULL",
      )
      .run()
    const failed = await call('/collect')
    assert.equal(failed.failure, 1)
    assert.equal(requests, 3)
    assert.equal(
      (await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first())
        .snapshot_json,
      stored,
    )
    const state = await db
      .prepare('SELECT error_code,next_run_at,retry_after_until FROM collection_state')
      .first()
    assert.equal(state.error_code, 'RATE_LIMITED')
    assert.ok(Date.parse(state.next_run_at) >= Date.parse(state.retry_after_until))
    assert.equal((await call('/collect')).selected, 0)
    assert.equal(requests, 3)
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
    assert.equal(requests, 3)
  } finally {
    await mf.dispose()
  }
})

test('Tencent seed upgrade preserves saved Yahoo configuration and encrypted credentials', async () => {
  const ring = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
  const options = convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-10-19',
    d1Databases: { SAVED: 'saved-yahoo', SECRET: 'credential-yahoo' },
  })
  options.resourcePersistencePath = await mkdtemp(resolve('.wrangler/tencent-upgrade-tests-'))
  const mf = new Miniflare(options)
  try {
    for (const binding of ['SAVED', 'SECRET']) {
      const db = await mf.getD1Database(binding)
      for (const file of (await readdir('migrations'))
        .filter((f) => f.endsWith('.sql') && f < '0014')
        .sort())
        await db.batch(
          unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
            db.prepare(sql),
          ),
        )
      if (binding === 'SAVED') {
        const current = await readConfig(db),
          config = editableConfig(current)
        config.site.siteName = 'User configuration to preserve'
        config.integrations[0].baseUrl = 'https://query2.finance.yahoo.com/'
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
      } else {
        const encrypted = await encryptCredential(
          'yahoo',
          'quotes-custom',
          'SYNTHETIC_KEY',
          ring,
          '2026-10-30T00:00:00.000Z',
        )
        await db
          .prepare(
            "UPDATE integrations SET credential_ciphertext=?,credential_iv=?,credential_key_version=?,credential_algorithm=?,credential_updated_at=? WHERE id='yahoo'",
          )
          .bind(
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.keyVersion,
            encrypted.algorithm,
            encrypted.updatedAt,
          )
          .run()
      }
      const before = await readConfig(db),
        envelope = await db.prepare("SELECT * FROM integrations WHERE id='yahoo'").first()
      await db.batch(
        unstable_splitSqlQuery(
          await readFile('migrations/0014_default_tencent_source.sql', 'utf8'),
        ).map((sql) => db.prepare(sql)),
      )
      assert.deepEqual(await readConfig(db), before)
      assert.deepEqual(
        await db.prepare("SELECT * FROM integrations WHERE id='yahoo'").first(),
        envelope,
      )
      assert.equal(
        (await db.prepare("SELECT count(*) n FROM integrations WHERE id='tencent'").first()).n,
        0,
      )
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
      if (binding === 'SECRET')
        assert.equal(
          await decryptCredential(
            'yahoo',
            'quotes-custom',
            {
              algorithm: envelope.credential_algorithm,
              ciphertext: envelope.credential_ciphertext,
              iv: envelope.credential_iv,
              keyVersion: envelope.credential_key_version,
              updatedAt: envelope.credential_updated_at,
            },
            ring,
          ),
          'SYNTHETIC_KEY',
        )
    }
  } finally {
    await mf.dispose()
  }
})
