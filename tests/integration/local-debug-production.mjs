import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { localRuntimeEnv } from '../../scripts/local-runtime-env.mjs'

Object.assign(process.env, localRuntimeEnv())
const require = createRequire(import.meta.url)
const wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const out = '.wrangler/test-results/local-debug-auth'
await mkdir(out, { recursive: true })
async function walk(directory) {
  const files = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name)
    files.push(...(item.isDirectory() ? await walk(path) : [path]))
  }
  return files
}
const credentials = JSON.parse(await readFile('.wrangler/local-debug/credentials.json', 'utf8'))
const vars = await readFile('.wrangler/local-debug/.dev.vars', 'utf8')
const limiterSecret = vars.match(/^AUTH_RATE_LIMIT_SECRET=(.+)$/m)[1]
const files = await walk(resolve('.output'))
for (const path of files) {
  const content = await readFile(path)
  for (const forbidden of [
    credentials.password,
    limiterSecret,
    credentials.email,
    'NOZOKI_LOCAL_AUTH_CONFIG',
    'local-debug-auth.mjs',
  ])
    assert.ok(
      !content.includes(Buffer.from(forbidden)),
      'Local debug data found in production output',
    )
}
const root = resolve('.output/server')
const modules = files
  .filter((f) => f.startsWith(root) && f.endsWith('.mjs'))
  .sort((a, b) =>
    a === resolve(root, 'index.mjs')
      ? -1
      : b === resolve(root, 'index.mjs')
        ? 1
        : a.localeCompare(b),
  )
  .map((path) => ({ type: 'ESModule', path }))
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules,
    modulesRoot: root,
    compatibilityDate: '2026-10-19',
    compatibilityFlags: ['nodejs_compat'],
    bindings: { NOZOKI_LOCAL_AUTH_CONFIG: resolve('.wrangler/local-debug/wrangler.jsonc') },
  }),
)
const report = { result: 'PASS', productionFilesScanned: files.length, checks: [] }
try {
  const response = await mf.dispatchFetch('https://nozoki.example/api/auth/login', {
    method: 'POST',
    headers: {
      Origin: 'https://nozoki.example',
      'Content-Type': 'application/json',
      'X-Forwarded-Host': '127.0.0.1:3000',
      'X-Forwarded-Proto': 'http',
    },
    body: JSON.stringify(credentials),
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'AUTH_UNAVAILABLE')
  assert.equal(response.headers.get('set-cookie'), null)
  report.checks.push(
    'production output excludes local debug password, limiter secret, email and config selector',
  )
  report.checks.push(
    'production workerd ignores injected local config selector; debug login fails closed with no session',
  )
  report.checks.push('forwarded host/protocol do not enable local authentication')
} finally {
  await mf.dispose()
}
await writeFile(out + '/production.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
