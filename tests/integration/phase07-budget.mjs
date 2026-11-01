// Local V8 sampling and D1 counters. These are not Cloudflare billed CPU measurements.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { localRuntimeEnv } from '../../scripts/local-runtime-env.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { source } from '../fixtures/adapters.ts'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import { ConfigSchema } from '../../shared/contracts/config.ts'
Object.assign(process.env, localRuntimeEnv())
delete process.env.NOZOKI_TEST_MINIFLARE
const require = createRequire(import.meta.url),
  wr = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wr('miniflare'),
  { unstable_splitSqlQuery } = require('wrangler')
const { WebSocket } = createRequire(wr.resolve('miniflare'))('ws')
const evidence = resolve('.wrangler/test-results/phase-07'),
  persist = await mkdtemp(resolve('.wrangler/phase07-budget-'))
await mkdir(evidence, { recursive: true })
const root = resolve('.output/server'),
  origin = 'http://127.0.0.1:8827'
async function walk(p) {
  return (
    await Promise.all(
      (await readdir(p, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(resolve(p, e.name)) : [resolve(p, e.name)],
      ),
    )
  ).flat()
}
const files = (await walk(root)).filter((p) => p.endsWith('.mjs'))
const wrapper = await build({
  stdin: {
    contents: `import app from './index.mjs';import{meterDatabase}from'${resolve('server/collection/metrics.ts').replaceAll('\\', '/')}';export default{...app,async fetch(req,env,ctx){const{db,metrics}=meterDatabase(env.DB);const r=await app.fetch(req,{...env,DB:db},ctx);const headers=new Headers(r.headers);headers.set('x-phase07-d1',JSON.stringify(metrics));return new Response(r.body,{status:r.status,headers})}}`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  external: ['./index.mjs'],
})
const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
const env = {
  ADMIN_EMAIL: 'owner@example.invalid',
  ADMIN_PASSWORD: 'SYNTHETIC-' + token(),
  AUTH_RATE_LIMIT_SECRET: token(),
  AUTH_VERSION: '1',
  AUTH_ORIGIN: origin,
  AUTH_ALLOW_LOCAL_HTTP: '1',
  COLLECTOR_EPOCH: '1',
}
const modules = [
  {
    type: 'ESModule',
    path: resolve(root, 'phase07-meter.mjs'),
    contents: wrapper.outputFiles[0].text,
  },
  ...files.map((path) => ({ type: 'ESModule', path })),
]
const opts = convertV4MiniflareOptions({
  modules,
  modulesRoot: root,
  host: '127.0.0.1',
  port: 8827,
  inspectorPort: 9347,
  compatibilityDate: '2026-10-19',
  compatibilityFlags: ['nodejs_compat'],
  bindings: env,
  d1Databases: { DB: 'phase07-budget' },
  assets: {
    directory: resolve('.output/public'),
    routerConfig: { has_user_worker: true },
    assetConfig: {},
  },
})
opts.resourcePersistencePath = persist
let mf = new Miniflare(opts),
  socket,
  db,
  cookie
const report = {
  runtime: 'native workerd, local V8 sampler + real D1, all data synthetic',
  persist,
  cases: [],
  cpuMeaning: 'Sampled local V8 active time estimate; not platform CPU or Free-tier certification',
  pure: [],
  collector: [],
}
async function profile(fn, name) {
  const endpoint = await mf.getInspectorURL()
  const targets = await (await fetch('http://' + endpoint.host + '/json')).json()
  const url = targets[0]?.webSocketDebuggerUrl
  if (!url) throw new Error('No inspected worker target')
  socket = new WebSocket(url, { origin: 'http://localhost' })
  await new Promise((ok, no) => {
    socket.addEventListener('open', ok, { once: true })
    socket.addEventListener('error', no, { once: true })
  })
  let seq = 0
  const pending = new Map()
  socket.addEventListener('message', (e) => {
    const r = JSON.parse(e.data)
    if (r.id && pending.has(r.id)) {
      const p = pending.get(r.id)
      pending.delete(r.id)
      r.error ? p.no(new Error(r.error.message)) : p.ok(r.result)
    }
  })
  const call = (method, params = {}) =>
    new Promise((ok, no) => {
      const id = ++seq
      pending.set(id, { ok, no })
      socket.send(JSON.stringify({ id, method, params }))
    })
  try {
    await call('Profiler.enable')
    await call('Profiler.setSamplingInterval', { interval: 100 })
    await call('Profiler.start')
    const wall = performance.now()
    const value = await fn()
    const elapsedMs = performance.now() - wall
    const { profile: p } = await call('Profiler.stop')
    const byId = new Map(p.nodes.map((n) => [n.id, n]))
    let active = 0,
      idle = 0,
      program = 0
    const hot = new Map()
    for (let i = 0; i < (p.samples ?? []).length; i++) {
      const frame = byId.get(p.samples[i]).callFrame,
        delta = (p.timeDeltas?.[i] ?? 0) / 1000
      if (frame.functionName === '(idle)') idle += delta
      else if (frame.functionName === '(program)') program += delta
      else {
        active += delta
        const key = frame.functionName + ' ' + frame.url
        hot.set(key, (hot.get(key) ?? 0) + delta)
      }
    }
    await writeFile(evidence + '/profile-' + name + '.json', JSON.stringify(p))
    return {
      value,
      elapsedMs,
      sampledActiveMs: active,
      idleMs: idle,
      programMs: program,
      samples: p.samples?.length ?? 0,
      hot: [...hot].sort((a, b) => b[1] - a[1]).slice(0, 8),
    }
  } finally {
    socket.close()
    socket = undefined
  }
}
async function request(path, init = {}) {
  const t = performance.now()
  const r = await mf.dispatchFetch(origin + path, init)
  const body = await r.text()
  const measured = {
    wallMs: performance.now() - t,
    status: r.status,
    bytes: Buffer.byteLength(body),
    d1: JSON.parse(r.headers.get('x-phase07-d1') ?? 'null'),
  }
  return { r, body, measured }
}
async function sample(name, n, fn) {
  const p = await profile(async () => {
    const values = []
    for (let i = 0; i < n; i++) values.push(await fn(i))
    return values
  }, name)
  const values = p.value
  delete p.value
  report.cases.push({ name, n, ...p, requests: values })
}
try {
  db = await mf.getD1Database('DB')
  for (const f of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile('migrations/' + f, 'utf8')).map((s) => db.prepare(s)),
    )
  await sample('guest-cold', 1, async () => {
    const r = await request('/api/dashboard')
    assert.equal(r.r.status, 200)
    return r.measured
  })
  await sample('guest-warm', 20, async () => (await request('/api/dashboard')).measured)
  const good = await request('/api/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
  })
  assert.equal(good.r.status, 200)
  cookie = good.r.headers.get('set-cookie').split(';')[0]
  await sample(
    'session',
    10,
    async () => (await request('/api/auth/session', { headers: { Cookie: cookie } })).measured,
  )
  await sample(
    'admin-config',
    5,
    async () => (await request('/api/admin/config', { headers: { Cookie: cookie } })).measured,
  )
  await sample('login', 3, async () => {
    const r = await request('/api/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
    })
    assert.equal(r.r.status, 200)
    return r.measured
  })
  const csrf = JSON.parse(
    (await request('/api/auth/csrf', { headers: { Cookie: cookie } })).body,
  ).token
  const cfg = JSON.parse((await request('/api/admin/config', { headers: { Cookie: cookie } })).body)
  await sample('config-noop', 4, async () => {
    const r = await request('/api/admin/config', {
      method: 'PUT',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Nozoki-CSRF': csrf,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        expectedVersion: cfg.site.configVersion,
        config: editableConfig(cfg),
      }),
    })
    assert.equal(r.r.status, 200)
    return r.measured
  })
  await sample('csrf-rejected', 3, async () => {
    const r = await request('/api/admin/config', {
      method: 'PUT',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(r.r.status, 403)
    return r.measured
  })
  const stored = await readConfig(db),
    config = editableConfig(stored),
    s = source('sleepy')
  const { credentialState, ...settings } = s
  config.modules.find((m) => m.id === 'quotes').sources = {}
  config.integrations = [{ ...settings, credential: { operation: 'keep' } }]
  const mod = config.modules.find((m) => m.id === 'devices')
  mod.visibility = 'public'
  mod.sources.main = { sourceId: s.id, subject: 'default' }
  mod.fields = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      '/devices/@d' + i + '/stateText',
      { enabled: true, visibility: 'admin' },
    ]),
  )
  config.links = Array.from({ length: 100 }, (_, i) => ({
    id: 'l' + i,
    title: 'Fixture ' + i,
    url: 'https://example.invalid/' + i,
    icon: 'link',
    visibility: 'public',
    enabled: true,
    sortOrder: i,
  }))
  assert.equal(
    (
      await saveConfig(
        db,
        { expectedVersion: stored.site.configVersion, config },
        { actor: { kind: 'system' } },
      )
    ).success,
    true,
  )
  const time = new Date().toISOString(),
    data = {
      devices: Array.from({ length: 100 }, (_, i) => ({
        id: 'd' + i,
        name: 'Synthetic device ' + i,
        using: true,
        stateText: 'PRIVATE-FIXTURE-' + 'Title '.repeat(300),
        online: null,
        batteryPercent: i % 2 ? null : 0,
        charging: null,
        observedAt: time,
        heartbeatAt: null,
        capabilities: {},
      })),
    }
  await upsertSnapshot(db, {
    sourceId: s.id,
    subject: 'default',
    moduleId: 'devices',
    snapshot: snapshot('ok', data, s.id),
    updatedAt: time,
  })
  await sample('large-guest', 8, async () => {
    const r = await request('/api/dashboard')
    assert.equal(r.r.status, 200)
    return r.measured
  })
  await sample('large-ssr', 3, async () => {
    const r = await request('/')
    assert.equal(r.r.status, 200)
    return r.measured
  })
  const validated = snapshot('ok', data, s.id)
  for (const [name, fn] of [
    ['snapshot-zod', () => snapshotSchema('devices').parse(validated)],
    ['config-zod', () => ConfigSchema.parse({ ...config, integrations: [s] })],
    ['snapshot-json', () => JSON.stringify(validated)],
  ]) {
    const cpu = process.cpuUsage(),
      t = performance.now()
    for (let i = 0; i < 100; i++) fn()
    const c = process.cpuUsage(cpu)
    report.pure.push({
      name,
      iterations: 100,
      nodeCpuMs: (c.user + c.system) / 1000,
      wallMs: performance.now() - t,
      runtime: process.version,
    })
  }
  // A separate native workerd hosts only the collector RPC fixture composition.
  await mf.dispose()
  const harness = await build({
    entryPoints: ['tests/integration/collector-harness.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    external: ['cloudflare:workers'],
  })
  const cOpts = convertV4MiniflareOptions({
    modules: true,
    script: harness.outputFiles[0].text,
    bindings: env,
    d1Databases: { DB: 'phase07-budget' },
    inspectorPort: 9347,
  })
  cOpts.resourcePersistencePath = persist
  mf = new Miniflare(cOpts)
  db = await mf.getD1Database('DB')
  const worker = await mf.getWorker()
  async function plans(spec) {
    await db.batch(
      [
        'balance_observations',
        'collection_runs',
        'collection_state',
        'integration_snapshot_views',
        'integration_snapshots',
      ].map((t) => db.prepare('DELETE FROM ' + t)),
    )
    const current = await readConfig(db),
      c = editableConfig(current)
    c.integrations = spec.map(([id, provider]) => {
      const { credentialState, ...settings } = source(provider)
      return { ...settings, id, credential: { operation: 'keep' } }
    })
    for (const m of c.modules) m.sources = {}
    for (const [id, provider, moduleId] of spec)
      c.modules.find((m) => m.id === moduleId).sources.main = { sourceId: id, subject: 'default' }
    assert.equal(
      (
        await saveConfig(
          db,
          { expectedVersion: current.site.configVersion, config: c },
          { actor: { kind: 'system' } },
        )
      ).success,
      true,
    )
  }
  for (const [name, spec, mode] of [
    ['empty', [], 'ok'],
    ['one', [['fixture', 'sleepy', 'devices']], 'ok'],
    [
      'two',
      [
        ['a', 'sleepy', 'devices'],
        ['b', 'deepseek', 'deepseek'],
      ],
      'ok',
    ],
    ['error', [['fixture', 'sleepy', 'devices']], 'auth'],
    ['429', [['fixture', 'sleepy', 'devices']], 'rate'],
  ]) {
    await plans(spec)
    const p = await profile(
      async () => JSON.parse(await worker.run(Date.now(), mode)),
      'collector-' + name,
    )
    report.collector.push({ name, ...p })
    if (name === 'one' || name === '429')
      report.collector.push({
        name: name + '-duplicate',
        ...(await profile(
          async () => JSON.parse(await worker.run(Date.now(), mode)),
          'collector-' + name + '-duplicate',
        )),
      })
  }
} finally {
  socket?.close()
  await mf.dispose()
  await writeFile(evidence + '/budget-local.json', JSON.stringify(report, null, 2))
}
console.log(
  JSON.stringify({
    cases: report.cases.length,
    collector: report.collector.length,
    meaning: report.cpuMeaning,
  }),
)
