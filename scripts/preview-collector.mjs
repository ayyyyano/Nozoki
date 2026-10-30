import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { localRuntimeEnv } from './local-runtime-env.mjs'
const require = createRequire(import.meta.url),
  bin = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
const child = spawn(
  process.execPath,
  [
    bin,
    'dev',
    '--config',
    resolve('workers/collector/wrangler.jsonc'),
    '--local',
    '--persist-to',
    resolve('.wrangler/state'),
  ],
  { stdio: 'inherit', env: localRuntimeEnv() },
)
child.on('exit', (code) => (process.exitCode = code ?? 1))
