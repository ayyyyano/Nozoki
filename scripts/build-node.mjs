import { spawn } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const nuxt = resolve(dirname(require.resolve('nuxt/package.json')), 'bin/nuxt.mjs')
const code = await new Promise((done, reject) => {
  const child = spawn(process.execPath, [nuxt, 'build'], {
    stdio: 'inherit',
    env: { ...process.env, NOZOKI_TARGET: 'node' },
  })
  child.once('error', reject)
  child.once('exit', (value) => done(value ?? 1))
})
if (code !== 0) process.exit(code)
await build({
  entryPoints: {
    start: 'platform/node/server.mjs',
    database: 'platform/node/database.mjs',
    collector: 'platform/node/collector.mjs',
  },
  outdir: '.output-node',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
})
await mkdir('.output-node/migrations', { recursive: true })
await cp('migrations', '.output-node/migrations', { recursive: true })
console.log('Node server, SQLite migrations and collector built in .output-node')
