import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { source, sleepMeta } from '../fixtures/adapters.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { managedTransport, managedEgressStatus } from '../../server/adapters/managed-transport.ts'

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve('wrangler/package.json'),
)('miniflare')
const script = (
  await build({
    entryPoints: ['tests/integration/worker-public-harness.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  })
).outputFiles[0].text
const common = {
  modules: true,
  script,
  compatibilityDate: '2026-10-19',
  compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
}
const invoke = async (mf, body) =>
  (
    await mf.dispatchFetch('https://harness.invalid/', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  ).json()

test('Worker public sources need no connector: exact GET, credential isolation, limits and probe', async (t) => {
  const calls = []
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      ...common,
      // Old connector variables must not divert a public Worker source to a gateway.
      bindings: {
        NOZOKI_CONNECTOR_URL: 'https://obsolete.example.com/',
        NOZOKI_CONNECTOR_TOKEN: 'A'.repeat(43),
      },
      serviceBindings: {
        NOZOKI_SOURCE_CONNECTOR: () => {
          throw new Error('Worker public source used an external connector')
        },
      },
      outboundService: async (request) => {
        calls.push({
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
        })
        const root = new URL(request.url).hostname
        if (root === 'redirect.example.com')
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://elsewhere.example.com/' },
          })
        if (root === 'oversize.example.com') return Response.json({ value: 'x'.repeat(131072) })
        if (root === 'slow.example.com')
          return new Response(new ReadableStream({ start() {} }), {
            headers: { 'Content-Type': 'application/json' },
          })
        return Response.json(sleepMeta)
      },
    }),
  )
  t.after(() => mf.dispose())
  assert.deepEqual(await invoke(mf, { operation: 'status' }), {
    configured: true,
    publicMode: 'worker',
    privateConfigured: false,
  })
  assert.deepEqual(await invoke(mf, { credential: 'must-not-leave' }), { value: sleepMeta })
  assert.equal(calls[0].url, 'https://source.example.com/service/api/meta')
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].headers.authorization, undefined)
  assert.equal(calls[0].headers.cookie, undefined)
  assert.equal(
    (await invoke(mf, { authentication: 'bearer', credential: 'synthetic-key' })).code,
    undefined,
  )
  assert.equal(calls.at(-1).headers.authorization, 'Bearer synthetic-key')
  const before = calls.length
  for (const [body, code] of [
    [{ approved: false }, 'ACCESS_NOT_APPROVED'],
    [{ mode: 'private', root: 'https://10.20.0.2/' }, 'DESTINATION_BLOCKED'],
    [{ authentication: 'bearer' }, 'AUTH_REQUIRED'],
    [{ authentication: 'bearer', credential: 'bad\r\nkey' }, 'CREDENTIAL_INVALID'],
    [{ root: 'https://127.0.0.1/' }, 'INVALID_SOURCE_TARGET'],
    [{ endpoint: '../admin' }, 'TARGET_NOT_APPROVED'],
    [{ endpoint: 'https://evil.example.com/' }, 'TARGET_NOT_APPROVED'],
    [{ endpoint: 'api/meta?url=https://evil.example.com/' }, 'TARGET_NOT_APPROVED'],
  ])
    assert.equal((await invoke(mf, body)).code, code)
  assert.equal(calls.length, before)
  assert.equal(
    (await invoke(mf, { root: 'https://redirect.example.com/' })).code,
    'REDIRECT_REJECTED',
  )
  assert.equal(calls.length, before + 1)
  assert.equal(
    (await invoke(mf, { root: 'https://oversize.example.com/' })).code,
    'RESPONSE_TOO_LARGE',
  )
  assert.equal(
    (await invoke(mf, { root: 'https://slow.example.com/', timeoutMs: 50 })).code,
    'TIMEOUT',
  )
  const probe = await invoke(mf, { operation: 'probe' })
  assert.equal(probe.code, undefined)
  assert.equal(probe.capabilities.metadata.verified, true)
})

test('workerd public network filters DNS-resolved loopback at connection time', async (t) => {
  let hits = 0
  const server = createServer((_request, response) => {
    hits++
    response.end('synthetic-local-server')
  })
  server.listen(0)
  await once(server, 'listening')
  t.after(() => new Promise((done) => server.close(done)))
  for (const allow of [['public'], ['public', 'private']]) {
    // Miniflare's development network allows private addresses. Run workerd itself
    // with the production public network, plus a private-enabled positive control.
    const folder = await mkdtemp(resolve('.wrangler/public-network-'))
    await writeFile(resolve(folder, 'worker.mjs'), script)
    const workerdRequire = createRequire(require.resolve('wrangler/package.json'))
    const listener = createServer()
    listener.listen(0, '127.0.0.1')
    await once(listener, 'listening')
    const port = listener.address().port
    await new Promise((done) => listener.close(done))
    await writeFile(
      resolve(folder, 'config.capnp'),
      `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "main", worker = (modules = [(name = "worker.mjs", esModule = embed "worker.mjs")], compatibilityDate = "2026-10-19", compatibilityFlags = ["nodejs_compat", "global_fetch_strictly_public"])),
    (name = "internet", network = (allow = ${JSON.stringify(allow)}, tlsOptions = (trustBrowserCas = true)))
  ], sockets = [(name = "http", address = "127.0.0.1:${port}", http = (), service = "main")]
);`,
    )
    const child = spawn(
      workerdRequire('workerd').default,
      ['serve', resolve(folder, 'config.capnp')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let log = ''
    child.stderr.on('data', (chunk) => {
      log += chunk
    })
    const call = async (body) =>
      (
        await fetch(`http://127.0.0.1:${port}/`, {
          method: 'POST',
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(4000),
        })
      ).json()
    try {
      let ready = false
      for (let i = 0; i < 60; i++) {
        try {
          await call({ operation: 'status' })
          ready = true
          break
        } catch {
          await delay(50)
        }
      }
      assert.ok(ready, log)
      const hosts =
        allow.length === 1
          ? ['127.0.0.1', 'localhost', '[::1]', '10.0.0.1', '169.254.169.254', '[fd00::1]']
          : ['127.0.0.1', 'localhost', '[::1]']
      for (const host of hosts) {
        const before = hits
        const result = await call({
          operation: 'network',
          root: `http://${host}:${server.address().port}/`,
        })
        if (allow.length === 1) {
          assert.ok(result.code, JSON.stringify(result))
          assert.doesNotMatch(result.code, /timeout/i)
          assert.equal(hits, before)
        } else {
          assert.equal(result.body, 'synthetic-local-server', JSON.stringify({ host, result, log }))
          assert.equal(hits, before + 1)
        }
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'exit')
        child.kill()
        await closed
      }
    }
  }
})

test('Node cannot opt into Worker public egress through source or environment settings', () => {
  const s = source('sleepy')
  s.baseUrl = 'https://source.example.com/'
  s.access = { mode: 'public', authentication: 'none', approved: true, approvedTarget: null }
  s.access.approvedTarget = sourceTargetKey(s, s.access)
  assert.deepEqual(managedEgressStatus({}), {
    configured: false,
    publicMode: 'unavailable',
    privateConfigured: false,
  })
  assert.throws(
    () =>
      managedTransport(s, undefined, {
        NOZOKI_RUNTIME: 'cloudflare',
        userAgent: 'Cloudflare-Workers',
      }),
    /CONNECTOR_UNAVAILABLE/,
  )
})
