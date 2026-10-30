import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomToken } from '../../server/services/auth-crypto.ts'
await mkdir('.wrangler/phase051-relay', { recursive: true })
const dir = await mkdtemp(resolve('.wrangler/phase051-relay/run-')),
  config = resolve(dir, 'config.json'),
  token = randomToken()
await writeFile(config, JSON.stringify({ sources: [] }))
const child = spawn(process.execPath, ['--experimental-strip-types', 'tools/private-relay.mjs'], {
  env: { ...process.env, NOZOKI_RELAY_CONFIG_FILE: config, NOZOKI_PRIVATE_RELAY_TOKEN: token },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let output = ''
const report = { runner: 'actual Node loopback HTTP process; no upstream configured', checks: [] }
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay startup timeout')), 5000)
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('relay exited before ready'))
    })
    child.stdout.on('data', (data) => {
      output += data.toString()
      if (output.includes('listening')) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  const headers = { Authorization: 'Bearer ' + token, 'X-Nozoki-Request': crypto.randomUUID() }
  for (const [path, init, status] of [
    ['/v1/sources/missing/read', { headers }, 404],
    ['/v1/sources/missing/read', {}, 401],
    ['/v8/management/credentials', { headers }, 400],
    ['/v1/sources/missing/read?target=https://evil.invalid', { headers }, 400],
    ['/v1/sources/missing/read', { headers: { ...headers, Origin: 'https://evil.invalid' } }, 400],
    ['/v1/sources/missing/read', { method: 'POST', headers, body: '{}' }, 400],
  ]) {
    const r = await fetch('http://127.0.0.1:8976' + path, init)
    assert.equal(r.status, status)
    await r.text()
    report.checks.push({ path: path.split('?')[0], method: init.method ?? 'GET', status })
  }
  assert.ok(!output.includes(token))
  console.log(JSON.stringify({ checks: report.checks.length, loopback: true }))
} finally {
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once('exit', resolve)
  })
  await writeFile(
    '.wrangler/test-results/phase-05.1/relay-process.json',
    JSON.stringify(report, null, 2),
  )
}
