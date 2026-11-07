// Actual production Modules Worker + assets, isolated D1; no write HTTP test endpoint.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = '.wrangler/test-results/phase-02-fixes'
const root = resolve('.output/server')
const walk = async (dir) =>
  (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
      ),
    )
  ).flat()
const modules = (await walk(root))
  .filter((p) => p.endsWith('.mjs'))
  .sort((a, b) =>
    a === resolve(root, 'index.mjs')
      ? -1
      : b === resolve(root, 'index.mjs')
        ? 1
        : a.localeCompare(b),
  )
  .map((path) => ({ type: 'ESModule', path }))
await mkdir('.wrangler/phase02-fixes', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase02-fixes/http-'))
const options = convertV4MiniflareOptions({
  modules,
  modulesRoot: root,
  compatibilityDate: '2026-10-19',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: { DB: 'isolated-http' },
  assets: {
    directory: resolve('.output/public'),
    routerConfig: { has_user_worker: true },
    assetConfig: {},
  },
})
options.resourcePersistencePath = persist
const mf = new Miniflare(options)
const report = { persist, checks: [] }
try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  const c = await readConfig(db)
  const input = {
    expectedVersion: c.site.configVersion,
    config: {
      ...c,
      integrations: [
        {
          id: 'http-source',
          provider: 'sleepy',
          protocolVersion: 'fixture',
          baseUrl: 'https://PRIVATE_SOURCE.invalid/api/',
          enabled: true,
          refreshInterval: 300,
          fieldMappings: {},
          capabilities: {},
          credential: { operation: 'keep' },
        },
      ],
    },
  }
  for (const id of ['devices', 'services']) {
    const m = input.config.modules.find((m) => m.id === id)
    m.visibility = 'public'
    m.sources.main = { sourceId: 'http-source', subject: 'shared' }
  }
  input.config.modules.find((m) => m.id === 'devices').fields = {
    '/devices/@private.device': { enabled: true, visibility: 'admin' },
    '/devices/*/stateText': { enabled: true, visibility: 'admin' },
  }
  input.config.modules.find((m) => m.id === 'services').fields = {
    '/monitors/@private~1monitor~0': { enabled: true, visibility: 'admin' },
  }
  assert.equal(
    (await saveConfig(db, input, { actor: { kind: 'system', id: 'http-fixes-test' } })).success,
    true,
  )
  const device = (id) => ({
    id,
    name: id,
    using: true,
    stateText: 'PRIVATE_STATE',
    online: true,
    batteryPercent: 0,
    charging: false,
    observedAt: null,
    heartbeatAt: null,
    capabilities: {},
  })
  const monitor = (id, state) => ({
    id,
    name: id,
    state,
    latencyMs: 0,
    checkedAt: null,
    statusPageUrl: null,
    uptimePercent: null,
    capabilities: {},
  })
  for (const [id, data] of [
    ['devices', { devices: [device('private.device'), device('PUBLIC_DEVICE')] }],
    [
      'services',
      { monitors: [monitor('private/monitor~', 'down'), monitor('PUBLIC_MONITOR', 'up')] },
    ],
  ])
    await upsertSnapshot(db, {
      sourceId: 'http-source',
      subject: 'shared',
      moduleId: id,
      snapshot: snapshot('ok', data, 'http-source'),
      updatedAt: '2026-10-26T10:00:00.000Z',
    })
  for (const query of ['', '?viewer=admin&role=admin&fixture=edge']) {
    const response = await mf.dispatchFetch('http://localhost/api/dashboard' + query, {
      headers: { Cookie: 'session=fake', 'x-viewer': 'admin' },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    const body = await response.json(),
      wire = JSON.stringify(body)
    assert.equal(body.viewer, 'guest')
    for (const marker of [
      'private.device',
      'private/monitor',
      'PRIVATE_SOURCE',
      'PRIVATE_STATE',
      'http-source',
      'credential',
      'ciphertext',
    ])
      assert.ok(!wire.includes(marker), marker)
    assert.equal(
      body.modules.find((m) => m.id === 'devices').snapshot.data.devices[0].batteryPercent,
      0,
    )
    assert.equal(
      body.modules.find((m) => m.id === 'services').snapshot.data.monitors[0].state,
      'up',
    )
    assert.deepEqual(body.summary, { services: { up: 1, down: 0 } })
    report.checks.push({
      request: '/api/dashboard' + query,
      status: 200,
      privateMarkersAbsent: true,
      sharedViewsReadable: true,
    })
  }
  const ssr = await mf.dispatchFetch('http://localhost/'),
    html = await ssr.text()
  assert.equal(ssr.status, 200)
  assert.ok(html.includes('Nozoki'))
  for (const marker of ['PRIVATE_STATE', 'PUBLIC_DEVICE', '开发预览', 'http-source'])
    assert.ok(!html.includes(marker))
  report.checks.push({ request: '/', status: 200, ssr: true, fixturesAbsent: true })
  for (const [path, method] of [
    ['/api/admin/config', 'PUT'],
    ['/api/dashboard', 'POST'],
    ['/api/auth/login', 'POST'],
  ]) {
    const response = await mf.dispatchFetch('http://localhost' + path, { method })
    assert.ok([404, 405].includes(response.status))
    report.checks.push({ request: path, method, status: response.status })
  }
} finally {
  await mf.dispose()
  await writeFile(`${evidence}/production-http.json`, JSON.stringify(report, null, 2))
}
