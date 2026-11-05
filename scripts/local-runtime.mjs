import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
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
}
const args = commands[process.argv[2]]
if (!args || process.argv.length !== 3) throw new Error('Unknown local runtime command')
const env = localRuntimeEnv()
if (process.argv[2] === 'd1-tests' && env.NOZOKI_TEST_MINIFLARE)
  throw new Error(
    'Formal D1 tests require native Miniflare; use test:d1:isolated explicitly for the legacy workaround',
  )
const child = spawn(process.execPath, args, { stdio: 'inherit', env })
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code) => (process.exitCode = code ?? 1))
