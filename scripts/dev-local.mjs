import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createServer } from 'node:net'
import { localRuntimeEnv } from './local-runtime-env.mjs'
import { prepareLocalAuth } from './local-debug-auth.mjs'

const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--local-auth')) throw new Error('Unknown local dev option')
// Nuxt otherwise silently selects another port, invalidating the trusted auth origin.
await new Promise((accept, reject) => {
  const probe = createServer()
  probe.once('error', () =>
    reject(new Error('Port 3000 is occupied; stop the old dev server first')),
  )
  probe.listen(3000, '127.0.0.1', () => probe.close(accept))
})
const env = localRuntimeEnv()
// No inherited debug override: only this explicit local command can select the private config.
delete env.NOZOKI_LOCAL_AUTH_CONFIG
if (args.includes('--local-auth')) {
  const local = await prepareLocalAuth()
  env.NOZOKI_LOCAL_AUTH_CONFIG = local.config
  console.log('Local-only login details: ' + local.loginFile)
  console.log('Isolated local D1; cloud builds do not load this configuration.')
}
const require = createRequire(import.meta.url)
const cli = resolve(dirname(require.resolve('nuxt/package.json')), 'bin/nuxt.mjs')
const child = spawn(process.execPath, [cli, 'dev', '--host', '127.0.0.1', '--port', '3000'], {
  env,
  stdio: 'inherit',
})
child.on('error', () => {
  console.error('Unable to start local Nuxt')
  process.exitCode = 1
})
child.on('exit', (code) => (process.exitCode = code ?? 1))
