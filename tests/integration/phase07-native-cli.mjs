// Unmodified Wrangler CLI, isolated SQLite, no real upstream or account operations.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { localRuntimeEnv } from '../../scripts/local-runtime-env.mjs'
const require = createRequire(import.meta.url)
const bin = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
const evidence = resolve('.wrangler/test-results/phase-07')
const base = await mkdtemp(resolve('.wrangler/phase07-cli-'))
const persist = resolve(base, 'state')
const env = localRuntimeEnv()
delete env.NOZOKI_TEST_MINIFLARE
const origin = 'http://127.0.0.1:8817'
const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
const password = 'SYNTHETIC-' + secret()
const common = {
  compatibility_date: '2026-10-19',
  compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'nozoki-local07',
      database_id: '00000000-0000-0000-0000-000000000002',
      remote: false,
      migrations_dir: resolve('migrations'),
    },
  ],
}
await mkdir(evidence, { recursive: true })
const dashboardConfig = resolve(base, 'worker.jsonc')
await writeFile(
  dashboardConfig,
  JSON.stringify({
    ...common,
    name: 'nozoki-local07-dashboard',
    main: resolve('.output/server/index.mjs'),
    assets: { directory: resolve('.output/public'), binding: 'ASSETS' },
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    triggers: { crons: ['*/5 * * * *'] },
  }),
)
// Only this isolated configuration directory can read these synthetic local secrets.
await writeFile(
  resolve(base, '.dev.vars'),
  `ADMIN_EMAIL="owner@example.invalid"\nADMIN_PASSWORD="${password}"\nAUTH_RATE_LIMIT_SECRET="${secret()}"\nAUTH_VERSION="1"\nAUTH_ORIGIN="${origin}"\nAUTH_ALLOW_LOCAL_HTTP="1"\n`,
  { mode: 0o600 },
)
const report = {
  native: true,
  base,
  persist,
  checks: [],
  children: [],
  migrations: [],
  shared: null,
}
function cli(args, label) {
  const r = spawnSync(process.execPath, [bin, ...args, '--config', dashboardConfig], {
    env,
    encoding: 'utf8',
    timeout: 60000,
  })
  // Migration output contains schema/row counts only. No secret values or API bodies.
  return writeFile(evidence + '/' + label + '.log', r.stdout + r.stderr).then(() => {
    assert.equal(r.status, 0, label)
    return r.stdout
  })
}
async function wait(url, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('Preview exited: ' + child.exitCode)
    try {
      const r = await fetch(url)
      if (r.status < 500) return r
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('Preview readiness timeout')
}
const children = []
function start(config, port, inspector, label) {
  const child = spawn(
    process.execPath,
    [
      bin,
      'dev',
      '--local',
      '--config',
      config,
      '--persist-to',
      persist,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspector),
      '--test-scheduled',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let logs = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => {
      logs += b
    })
  children.push({ child, label, logs: () => logs })
  report.children.push({ label, pid: child.pid })
  return child
}
try {
  await cli(
    ['d1', 'migrations', 'apply', 'nozoki-local07', '--local', '--persist-to', persist],
    'native-migrations',
  )
  report.checks.push('unmodified Wrangler applies 0001-0010 to isolated D1')
  await cli(
    ['d1', 'migrations', 'apply', 'nozoki-local07', '--local', '--persist-to', persist],
    'native-migrations-repeat',
  )
  report.checks.push('repeat CLI migration has no pending work')
  const dash = start(dashboardConfig, 8817, 9337, 'dashboard')
  assert.equal((await wait(origin + '/api/dashboard', dash)).status, 200)
  const login = await fetch(origin + '/api/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.invalid', password }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const csrf = (
    await (await fetch(origin + '/api/auth/csrf', { headers: { Cookie: cookie } })).json()
  ).token
  const config = await (
    await fetch(origin + '/api/admin/config', { headers: { Cookie: cookie } })
  ).json()
  for (const item of config.integrations) item.enabled = false
  config.site.siteName = 'Phase07 native CLI fixture'
  config.integrations = config.integrations.map(({ credentialState, ...s }) => ({
    ...s,
    credential: { operation: 'keep' },
  }))
  const saved = await fetch(origin + '/api/admin/config', {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Nozoki-CSRF': csrf,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ expectedVersion: config.site.configVersion, config }),
  })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).success, true)
  report.checks.push('native Dashboard HTTP auth/CSRF/CAS writes isolated D1')
  const scheduled = await fetch(
    origin + '/cdn-cgi/handler/scheduled?cron=' + encodeURIComponent('*/5 * * * *'),
  )
  assert.equal(scheduled.status, 200)
  await new Promise((r) => setTimeout(r, 500))
  const results = await cli(
    [
      'd1',
      'execute',
      'nozoki-local07',
      '--local',
      '--persist-to',
      persist,
      '--command',
      "SELECT (SELECT json_extract(settings_json,'$.siteName') FROM site_settings WHERE id=1) AS site_name,(SELECT epoch FROM collector_environment WHERE id=1) AS epoch,(SELECT count(*) FROM collection_runs) AS runs;",
      '--json',
    ],
    'native-shared-read',
  )
  assert.ok(results.includes('Phase07 native CLI fixture'))
  assert.match(results, /"epoch":\s*1/)
  assert.match(results, /"runs":\s*0/)
  report.shared = {
    dashboardWriteRead: true,
    collectorWriteRead: true,
    samePersist: persist,
    realCronInvocations: 0,
    upstreamRequests: 0,
  }
  report.checks.push('HTTP and scheduled events share one Worker and one SQLite namespace')
  report.checks.push('Local Explorer scheduled endpoint completes empty schedule without upstream')
  const selection = process.argv
    .find((a) => a.startsWith('--ui='))
    ?.slice(5)
    .split(',')
  if (process.argv.includes('--ui') || selection) {
    const dir = resolve(evidence, 'production')
    await mkdir(dir, { recursive: true })
    report.browser = []
    const allowed = [
      'sliders',
      'layout013',
      'palette012',
      'wallpaper012',
      'icons012',
      'loading-followup',
      'dx-transition',
    ]
    assert.ok(!selection || selection.every((s) => allowed.includes(s)))
    for (const script of selection ?? allowed) {
      const r = spawnSync(process.execPath, ['tests/browser/' + script + '.mjs'], {
        env: { ...env, BASE_URL: origin, CHECK_PRODUCTION: '1', EVIDENCE_DIR: dir },
        timeout: 150000,
        encoding: 'utf8',
      })
      await writeFile(dir + '/' + script + '.log', r.stdout + r.stderr)
      report.browser.push({ script, exit: r.status, error: r.error?.message })
    }
    assert.ok(
      report.browser.every((r) => r.exit === 0),
      'Browser failures: ' + JSON.stringify(report.browser),
    )
  }
} finally {
  for (const { child, label, logs } of children) {
    if (child.exitCode === null) {
      // Terminate only this script's own CLI process tree, including workerd.
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGTERM')
    }
    const safe = logs().replaceAll(password, '[REDACTED]')
    await writeFile(evidence + '/native-' + label + '-preview.log', safe)
  }
  await writeFile(evidence + '/native-cli.json', JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report))
