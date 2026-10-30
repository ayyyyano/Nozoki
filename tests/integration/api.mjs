import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
const dir = '.wrangler/test-results/phase-02'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8788'
assert.equal(new URL(base).hostname, '127.0.0.1')
const probe = JSON.parse(await readFile(`${dir}/preview-persistence.json`, 'utf8'))
const expectedName = process.env.CHECK_RESTORED === '1' ? probe.originalName : probe.marker
const cases = []
for (const suffix of ['/api/dashboard', '/api/dashboard?role=admin&viewer=admin&fixture=edge']) {
  const r = await fetch(base + suffix, { headers: { Cookie: 'session=fake-admin-token' } }),
    body = await r.json()
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'private, no-store')
  assert.equal(body.viewer, 'guest')
  assert.equal(body.site.siteName, expectedName)
  assert.equal(body.contractVersion, 1)
  assert.deepEqual(
    body.modules.filter((m) => m.kind === 'data').map((m) => m.id),
    ['activity', 'quotes', 'links'],
  )
  assert.ok(
    body.modules
      .filter((m) => m.kind === 'login_required')
      .every((m) => Object.keys(m).sort().join(',') === 'id,kind,sortOrder,title'),
  )
  const wire = JSON.stringify(body)
  for (const s of ['sourceId', 'baseUrl', 'credential', 'ciphertext', 'D1Database', 'C:\\Users\\'])
    assert.ok(!wire.includes(s))
  cases.push({ path: suffix, status: r.status, body })
}
for (const [path, method] of [
  ['/api/admin/config', 'GET'],
  ['/api/admin/config', 'PUT'],
  ['/api/admin/integrations/fake/test', 'POST'],
  ['/api/auth/login', 'POST'],
  ['/api/dashboard', 'PUT'],
]) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  })
  assert.ok([401, 403, 404, 405].includes(r.status), `${method} ${path}: ${r.status}`)
  cases.push({ path, method, status: r.status })
}
const dev = await fetch(`${process.env.DEV_BASE_URL ?? 'http://127.0.0.1:3001'}/api/dashboard`),
  body = await dev.json()
assert.equal(dev.status, 200)
assert.equal(body.viewer, 'guest')
assert.equal(body.site.siteName, expectedName)
cases.push({
  devLocalBinding: { status: dev.status, viewer: body.viewer, siteName: body.site.siteName },
})
await writeFile(
  `${dir}/api-${process.env.CHECK_RESTORED === '1' ? 'restored' : process.env.RESTART_CHECK === '1' ? 'restarted' : 'initial'}.json`,
  JSON.stringify({ base, cases }, null, 2),
)
console.log(`PASS ${cases.length} HTTP checks; local D1 record is visible`)
