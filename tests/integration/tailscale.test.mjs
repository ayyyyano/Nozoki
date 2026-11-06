import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { importCredentialKey } from '../../server/services/credentials.ts'
import { tailscaleFixture, tailscaleCredentials } from '../fixtures/tailscale.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const files = (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()
const sql = await readFile('migrations/0016_tailscale_module.sql', 'utf8')
const apply = (db, text) => db.batch(unstable_splitSqlQuery(text).map((s) => db.prepare(s)))

test('native D1 migration preserves old views, rolls back DDL on failure, and fences old drafts', async () => {
  const options = convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-10-19',
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    d1Databases: { DB: 'tailnet-upgrade', FAIL: 'tailnet-rollback' },
  })
  options.resourcePersistencePath = await mkdtemp(resolve('.wrangler/tailscale-upgrade-'))
  const mf = new Miniflare(options)
  try {
    for (const name of ['DB', 'FAIL']) {
      const db = await mf.getD1Database(name)
      for (const f of files.filter((f) => f < '0016'))
        await apply(db, await readFile('migrations/' + f, 'utf8'))
      await db
        .prepare(
          'UPDATE dashboard_modules SET title=\'Custom devices\', fields_json=\'{"name":{"enabled":false,"visibility":"admin"}}\' WHERE id=\'devices\'',
        )
        .run()
      await db
        .prepare(
          "INSERT INTO integration_snapshots(source_id,subject,updated_at) VALUES('tencent','fixture','2026-11-01T00:00:00.000Z')",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO integration_snapshot_views(source_id,subject,module_id,snapshot_json,updated_at) VALUES('tencent','fixture','quotes','{}','2026-11-01T00:00:00.000Z')",
        )
        .run()
      const before = await db.prepare('SELECT config_version FROM site_settings').first()
      const views = (await db.prepare('SELECT * FROM integration_snapshot_views').all()).results
      if (name === 'FAIL') {
        await db
          .prepare(
            "CREATE TRIGGER fixture_fail BEFORE INSERT ON integration_audit WHEN NEW.id='migration-0016-tailscale' BEGIN SELECT RAISE(ABORT,'INJECTED_FAILURE'); END",
          )
          .run()
        await assert.rejects(apply(db, sql), /INJECTED_FAILURE/)
        assert.equal((await db.prepare('SELECT count(*) n FROM dashboard_modules').first()).n, 7)
        assert.ok(
          !(await db.prepare('PRAGMA table_info(dashboard_modules)').all()).results.some(
            (c) => c.name === 'ip_visibility',
          ),
        )
      } else {
        await apply(db, sql)
        assert.equal((await db.prepare('SELECT count(*) n FROM dashboard_modules').first()).n, 8)
        assert.equal(
          (await db.prepare("SELECT title FROM dashboard_modules WHERE id='devices'").first())
            .title,
          'Custom devices',
        )
        assert.equal(
          (await db.prepare("SELECT enabled FROM dashboard_modules WHERE id='tailscale'").first())
            .enabled,
          0,
        )
        assert.equal(
          (await db.prepare('SELECT config_version FROM site_settings').first()).config_version,
          before.config_version + 1,
        )
        await assert.rejects(
          db
            .prepare('INSERT INTO config_write_guard(id,token,expected_version) VALUES(1,?,?)')
            .bind('old-draft', before.config_version)
            .run(),
          /NOZOKI_CONFIG_CONFLICT/,
        )
      }
      assert.deepEqual(
        (await db.prepare('SELECT * FROM integration_snapshot_views').all()).results,
        views,
      )
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    }
  } finally {
    await mf.dispose()
  }
})

test('workerd collects two bounded OAuth requests, persists independent Tailscale views and enforces IP policy', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32)),
    ring = await importCredentialKey('v1', key)
  const script = (
    await build({
      entryPoints: ['tests/integration/tailscale-worker.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      external: ['cloudflare:workers'],
    })
  ).outputFiles[0].text
  let requests = 0,
    fail = false
  const options = convertV4MiniflareOptions({
    modules: true,
    script,
    compatibilityDate: '2026-10-19',
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    d1Databases: { DB: 'tailnet-collector' },
    bindings: {
      COLLECTOR_EPOCH: '1',
      INTEGRATION_KEY_VERSION: 'v1',
      INTEGRATION_ENCRYPTION_KEY: Buffer.from(key).toString('base64url'),
    },
    outboundService: async (req) => {
      requests++
      assert.equal(new URL(req.url).origin, 'https://api.tailscale.com')
      assert.equal(req.headers.get('cookie'), null)
      if (new URL(req.url).pathname === '/api/v2/oauth/token') {
        assert.equal(req.method, 'POST')
        assert.equal(req.headers.get('authorization'), null)
        const body = new URLSearchParams(await req.text())
        assert.equal(body.get('scope'), 'devices:core:read')
        assert.equal(body.get('client_secret'), 'synthetic-secret')
        return Response.json({
          access_token: 'synthetic-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }
      assert.equal(new URL(req.url).pathname, '/api/v2/tailnet/-/devices')
      assert.equal(req.method, 'GET')
      assert.equal(req.headers.get('authorization'), 'Bearer synthetic-access-token')
      return fail ? new Response(null, { status: 401 }) : Response.json(tailscaleFixture())
    },
  })
  options.resourcePersistencePath = await mkdtemp(resolve('.wrangler/tailscale-collector-'))
  const mf = new Miniflare(options)
  try {
    const db = await mf.getD1Database('DB')
    for (const f of files) await apply(db, await readFile('migrations/' + f, 'utf8'))
    let current = await readConfig(db),
      draft = editableConfig(current)
    draft.integrations.forEach((s) => (s.enabled = false))
    draft.integrations.push({
      id: 'tailnet',
      provider: 'tailscale',
      protocolVersion: 'tailscale-devices-v2',
      baseUrl: 'https://api.tailscale.com/',
      enabled: true,
      refreshInterval: 300,
      fieldMappings: {},
      capabilities: {},
      credential: { operation: 'replace', value: tailscaleCredentials },
    })
    const source = draft.integrations.at(-1)
    source.access = {
      mode: 'public',
      authentication: 'tailscale-oauth',
      approved: true,
      approvedTarget: null,
    }
    source.access.approvedTarget = sourceTargetKey(source, source.access)
    const module = draft.modules.find((m) => m.id === 'tailscale')
    module.enabled = true
    module.visibility = 'public'
    module.sources.main = { sourceId: 'tailnet', subject: 'default' }
    assert.equal(
      (
        await saveConfig(
          db,
          { expectedVersion: current.site.configVersion, config: draft },
          { actor: { kind: 'system' }, keys: ring },
        )
      ).success,
      true,
    )
    const run = await (await mf.dispatchFetch('http://localhost/collect')).json()
    assert.equal(run.success, 1, JSON.stringify(run))
    assert.equal(requests, 2)
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM integration_snapshot_views WHERE module_id='tailscale'")
          .first()
      ).n,
      1,
    )
    for (const policy of ['admin', 'hidden', 'public']) {
      current = await readConfig(db)
      draft = editableConfig(current)
      draft.modules.find((m) => m.id === 'tailscale').ipVisibility = policy
      assert.equal(
        (
          await saveConfig(
            db,
            { expectedVersion: current.site.configVersion, config: draft },
            { actor: { kind: 'system' } },
          )
        ).success,
        true,
      )
      for (const role of ['guest', 'admin']) {
        const dto = await (await mf.dispatchFetch('http://localhost/' + role)).json(),
          text = JSON.stringify(dto)
        assert.equal(
          text.includes('100.64.1.2'),
          policy === 'public' || (policy === 'admin' && role === 'admin'),
        )
        assert.ok(text.includes('Fixture laptop'))
        assert.ok(
          !text.includes('synthetic-secret') &&
            !text.includes('private-node-key') &&
            !text.includes('private@example.invalid'),
        )
      }
    }
    const old = (
      await db
        .prepare("SELECT snapshot_json FROM integration_snapshot_views WHERE source_id='tailnet'")
        .first()
    ).snapshot_json
    fail = true
    await db.prepare("UPDATE collection_state SET next_run_at='2000-01-01T00:00:00.000Z'").run()
    await mf.dispatchFetch('http://localhost/collect')
    assert.equal(
      (
        await db
          .prepare("SELECT snapshot_json FROM integration_snapshot_views WHERE source_id='tailnet'")
          .first()
      ).snapshot_json,
      old,
    )
    assert.equal(
      (
        await db
          .prepare("SELECT error_code FROM collection_state WHERE source_id='tailnet'")
          .first()
      ).error_code,
      'AUTH_REQUIRED',
    )
    current = await readConfig(db)
    draft = editableConfig(current)
    draft.modules.find((m) => m.id === 'tailscale').enabled = false
    assert.equal(
      (
        await saveConfig(
          db,
          { expectedVersion: current.site.configVersion, config: draft },
          { actor: { kind: 'system' } },
        )
      ).success,
      true,
    )
    const before = requests
    await mf.dispatchFetch('http://localhost/collect')
    await mf.dispatchFetch('http://localhost/guest')
    assert.equal(requests, before)
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
  } finally {
    await mf.dispose()
  }
})
