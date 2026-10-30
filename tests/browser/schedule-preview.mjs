import { DatabaseSync, backup } from 'node:sqlite'
import { mkdir, readdir, writeFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { localRuntimeEnv } from '../../scripts/local-runtime-env.mjs'
const root = process.cwd()
const base = resolve('.wrangler/schedule-ui')
const state = resolve(base, 'state')
const sourceDir = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
const files = (await readdir(sourceDir)).filter((f) => /^[a-f0-9]{64}\.sqlite$/.test(f))
if (files.length !== 1) throw new Error('Expected exactly one daily local database')
const destinationDir = resolve(state, 'v3/d1/miniflare-D1DatabaseObject')
await mkdir(destinationDir, { recursive: true })
const destination = resolve(destinationDir, files[0])
try {
  await access(destination)
} catch {
  const db = new DatabaseSync(resolve(sourceDir, files[0]), { readOnly: true })
  await backup(db, destination)
  db.close()
  const copy = new DatabaseSync(destination, { readOnly: true })
  if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
    throw new Error('Backup verification failed')
  copy.close()
}
const origin = 'http://127.0.0.1:8796'
const secret = () => randomBytes(32).toString('base64url')
const credentialsFile = resolve(base, 'credentials.json')
let credentials
try {
  credentials = JSON.parse(
    await (await import('node:fs/promises')).readFile(credentialsFile, 'utf8'),
  )
} catch {
  credentials = {
    email: 'preview@nozoki.local',
    password: 'Local-' + randomBytes(15).toString('base64url'),
  }
  await writeFile(credentialsFile, JSON.stringify(credentials), { mode: 0o600 })
  await writeFile(
    resolve(base, '.dev.vars'),
    [
      `ADMIN_EMAIL=${credentials.email}`,
      `ADMIN_PASSWORD=${credentials.password}`,
      `AUTH_VERSION=1`,
      `AUTH_RATE_LIMIT_SECRET=${secret()}`,
      `AUTH_ORIGIN=${origin}`,
      `AUTH_ALLOW_LOCAL_HTTP=1`,
      `INTEGRATION_KEY_VERSION=preview-v1`,
      `INTEGRATION_ENCRYPTION_KEY=${secret()}`,
    ].join('\n') + '\n',
    { mode: 0o600 },
  )
  await writeFile(
    resolve(base, 'LOGIN.txt'),
    `LOCAL PREVIEW ONLY\nURL: ${origin}/login\nEmail: ${credentials.email}\nPassword: ${credentials.password}\n\nIsolated database cloned from daily local D1. Changes do not affect the daily database.\nRestart from project root: node tests/browser/schedule-preview.mjs\n`,
    { mode: 0o600 },
  )
}
const config = resolve(base, 'wrangler.jsonc')
await writeFile(
  config,
  JSON.stringify(
    {
      name: 'nozoki-admin-local-preview',
      main: resolve('.output/server/index.mjs'),
      compatibility_date: '2026-10-19',
      compatibility_flags: ['nodejs_compat'],
      assets: { directory: resolve('.output/public'), binding: 'ASSETS' },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'nozoki-admin-preview',
          database_id: '00000000-0000-0000-0000-000000000002',
          remote: false,
          migrations_dir: resolve('migrations'),
        },
      ],
    },
    null,
    2,
  ),
)
const require = createRequire(import.meta.url)
const cli = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
console.log('Starting isolated admin preview at ' + origin + '/login')
console.log('Local login details: ' + resolve(base, 'LOGIN.txt'))
const child = spawn(
  process.execPath,
  [
    cli,
    'dev',
    '--local',
    '--config',
    config,
    '--persist-to',
    state,
    '--ip',
    '127.0.0.1',
    '--port',
    '8796',
    '--inspector-port',
    '9396',
  ],
  { cwd: root, env: localRuntimeEnv(), stdio: 'inherit' },
)
child.on('exit', (code) => process.exit(code ?? 1))
process.on('SIGINT', () => child.kill('SIGINT'))
