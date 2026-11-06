import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { localRuntimeEnv } from './local-runtime-env.mjs'
const require = createRequire(import.meta.url)
const wrangler = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
const commands = {
  preview: [
    wrangler,
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '8787',
    '--test-scheduled',
    '--persist-to',
    resolve('.wrangler/state'),
  ],
  migrate: [
    wrangler,
    'd1',
    'migrations',
    'apply',
    'nozoki-db',
    '--local',
    '--persist-to',
    resolve('.wrangler/state'),
  ],
  'd1-tests': [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    'tests/integration/*.test.mjs',
  ],
  'access-tests': [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    'tests/integration/source-access.test.mjs',
    'tests/integration/worker-public.test.mjs',
  ],
  'browser-tests': [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    'tests/self-host/http.test.mjs',
    'tests/self-host/schedule-labels.test.mjs',
    'tests/integration/source-access.test.mjs',
    'tests/integration/config-refresh.test.mjs',
  ],
}
const args = commands[process.argv[2]]
if (!args || process.argv.length !== 3) throw new Error('Unknown local runtime command')
const env = localRuntimeEnv()
const mode = process.argv[2]
if (mode === 'browser-tests') env.NOZOKI_TEST_BROWSER = '1'
else delete env.NOZOKI_TEST_BROWSER
if (['d1-tests', 'access-tests', 'browser-tests'].includes(mode)) {
  if (env.NOZOKI_TEST_MINIFLARE)
    throw new Error('Unset NOZOKI_TEST_MINIFLARE to use the installed runtime')
  if (!existsSync(resolve('.output/server/index.mjs')))
    throw new Error('Run pnpm build before Worker tests')
}
if (mode === 'browser-tests' && !existsSync(resolve('.output-node/start.mjs')))
  throw new Error('Run pnpm build:node before Node browser tests')
const child = spawn(process.execPath, args, { stdio: 'inherit', env })
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code) => (process.exitCode = code ?? 1))
