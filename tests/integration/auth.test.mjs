import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { authSettings } from '../../server/services/auth-settings.ts'
import { login } from '../../server/services/auth.ts'
import { findSession } from '../../server/services/sessions.ts'
import { hashToken, randomToken } from '../../server/services/auth-crypto.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = process.env.NOZOKI_AUTH_EVIDENCE ?? '.wrangler/test-results/phase-03'
await mkdir(evidence, { recursive: true })
await mkdir('.wrangler/phase03-tests', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase03-tests/run-'))
const password = 'SYNTHETIC-' + crypto.randomUUID()
const env = {
  ADMIN_EMAIL: 'owner@example.invalid',
  ADMIN_PASSWORD: password,
  AUTH_RATE_LIMIT_SECRET: randomToken(),
  AUTH_VERSION: '1',
  AUTH_ORIGIN: 'http://127.0.0.1:8793',
  AUTH_ALLOW_LOCAL_HTTP: '1',
}
const script = (
  await build({
    entryPoints: ['tests/integration/auth-worker.ts'],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'browser',
    external: ['cloudflare:workers'],
  })
).outputFiles[0].text
const options = convertV4MiniflareOptions({
  modules: true,
  script,
  compatibilityDate: '2026-10-19',
  d1Databases: { DB: 'auth-isolated' },
  bindings: env,
})
options.resourcePersistencePath = persist
let mf = new Miniflare(options),
  db = await mf.getD1Database('DB')
const report = {
  persist,
  runtime: wrangler('miniflare/package.json').version,
  checks: [],
  concurrency: null,
}
const now = '2026-11-01T00:00:00.000Z'
const count = async (table) => (await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n
const attempt = async (body, at = now, previous, source) =>
  JSON.parse(await (await mf.getWorker()).attempt(body, at, previous, source))
const inspect = async (token, at = now, touch = true) =>
  JSON.parse(await (await mf.getWorker()).inspect(token, at, touch))
let token, second
test('phase 03 authentication uses real workerd Web Crypto and persistent D1', async (t) => {
  t.after(async () => {
    await mf.dispose()
    await writeFile(`${evidence}/auth-d1.json`, JSON.stringify(report, null, 2))
  })
  const check = (name, fn) =>
    t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  await check('migrations prepare empty and legacy-safe auth tables', async () => {
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    assert.equal(await count('sessions'), 0)
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    await assert.rejects(() =>
      db
        .prepare('INSERT INTO login_limits VALUES(?,1,?,NULL,?)')
        .bind('a'.repeat(64), '2026-02-30T00:00:00.000Z', now)
        .run(),
    )
  })
  await check(
    'wrong email, case variants, wrong password and invalid inputs have no session and identical public error',
    async () => {
      for (const body of [
        { email: 'wrong@example.invalid', password },
        { email: 'OWNER@EXAMPLE.INVALID', password: 'wrong' },
        { email: env.ADMIN_EMAIL, password: '' },
        { email: 12, password },
        { email: env.ADMIN_EMAIL, password: 'x'.repeat(1025) },
      ]) {
        const result = await attempt(body)
        assert.deepEqual(result, { success: false, code: 'INVALID_CREDENTIALS', status: 401 })
      }
      assert.equal(await count('sessions'), 0)
      assert.equal((await attempt({ email: env.ADMIN_EMAIL, password })).status, 429)
      const rows = (await db.prepare('SELECT * FROM login_limits').all()).results
      assert.equal(rows[0].failures, 5)
      assert.ok(!JSON.stringify(rows).includes(env.ADMIN_EMAIL))
      assert.ok(!JSON.stringify(rows).includes(password))
      await db.prepare('DELETE FROM login_limits').run()
      const variant = await attempt({ email: env.ADMIN_EMAIL, password: password + '\u0000' })
      report.passwordVariant = { appendedNulAccepted: variant.success }
      assert.equal(variant.success, false, 'password byte variants must not authenticate')
      assert.equal(await count('sessions'), 0)
      await db.prepare('DELETE FROM login_limits').run()
    },
  )
  await check(
    'parallel wrong attempts atomically cap account/source slots without lost increments',
    async () => {
      const worker = await mf.getWorker()
      const results = await Promise.all(
        Array.from({ length: 24 }, async (_, i) =>
          JSON.parse(
            await worker.attempt(
              {
                email: i % 2 ? 'OWNER@EXAMPLE.INVALID' : 'not-owner@example.invalid',
                password: 'wrong',
              },
              now,
              undefined,
              'loopback',
            ),
          ),
        ),
      )
      assert.equal(results.filter((r) => r.status === 401).length, 5)
      assert.equal(results.filter((r) => r.status === 429).length, 19)
      const rows = (
        await db.prepare('SELECT failures FROM login_limits ORDER BY failures').all()
      ).results.map((r) => r.failures)
      assert.deepEqual(rows, [5, 20])
      report.concurrency = { requests: 24, credentialChecks: 5, rejected: 19, counts: rows }
    },
  )
  await check(
    'expired limits recover and successful normalized email login creates hashed new sessions',
    async () => {
      const later = '2026-11-01T00:06:00.000Z'
      const result = await attempt(
        { email: '  OWNER@EXAMPLE.INVALID  ', password },
        later,
        'A'.repeat(43),
      )
      assert.equal(result.success, true)
      token = result.token
      assert.notEqual(token, 'A'.repeat(43))
      assert.equal((await inspect(token, later)).viewer, 'admin')
      const rows = (await db.prepare('SELECT * FROM sessions').all()).results
      assert.equal(rows.length, 1)
      assert.equal(rows[0].token_hash, await hashToken(token))
      const binding = await db
        .prepare('SELECT auth_fingerprint FROM session_bindings WHERE token_hash=?')
        .bind(await hashToken(token))
        .first()
      assert.notEqual(binding.auth_fingerprint, (await authSettings(env)).fingerprint)
      assert.ok(!JSON.stringify(rows).includes(token))
      assert.ok(!JSON.stringify(rows).includes(password))
      assert.equal(Date.parse(rows[0].expires_at) - Date.parse(rows[0].created_at), 43200000)
      assert.equal(Date.parse(rows[0].idle_expires_at) - Date.parse(rows[0].created_at), 1800000)
    },
  )
  await check(
    'touch throttling slides idle deadline only, absolute and idle expiry both deny access',
    async () => {
      const first = await db
        .prepare('SELECT * FROM sessions WHERE token_hash=?')
        .bind(await hashToken(token))
        .first()
      assert.equal((await inspect(token, '2026-11-01T00:07:00.000Z')).viewer, 'admin')
      assert.deepEqual(
        await db
          .prepare('SELECT * FROM sessions WHERE token_hash=?')
          .bind(await hashToken(token))
          .first(),
        first,
      )
      await db.prepare('CREATE TABLE auth_touch_probe(n INTEGER)').run()
      await db
        .prepare(
          'CREATE TRIGGER auth_touch_count AFTER UPDATE OF last_seen_at ON sessions BEGIN INSERT INTO auth_touch_probe VALUES(1); END',
        )
        .run()
      try {
        const active = await Promise.all(
          Array.from({ length: 12 }, () => inspect(token, '2026-11-01T00:12:00.000Z')),
        )
        assert.ok(active.every((v) => v.viewer === 'admin'))
        const writes = await count('auth_touch_probe')
        assert.equal(writes, 1)
        report.concurrentTouch = {
          requests: 12,
          administrators: active.filter((v) => v.viewer === 'admin').length,
          writes,
        }
      } finally {
        await db.prepare('DROP TRIGGER auth_touch_count').run()
        await db.prepare('DROP TABLE auth_touch_probe').run()
      }
      const touched = await db
        .prepare('SELECT * FROM sessions WHERE token_hash=?')
        .bind(await hashToken(token))
        .first()
      assert.equal(touched.expires_at, first.expires_at)
      assert.equal(touched.last_seen_at, '2026-11-01T00:12:00.000Z')
      assert.equal((await inspect(token, '2026-11-01T00:42:00.000Z')).viewer, 'guest')
      assert.equal((await inspect(token, '2026-11-02T00:00:00.000Z')).viewer, 'guest')
    },
  )
  await check(
    'fresh login rotates and revokes old session; signed CSRF cannot cross sessions or be forged',
    async () => {
      const r = await attempt(
        { email: env.ADMIN_EMAIL, password },
        '2026-11-01T00:13:00.000Z',
        token,
      )
      assert.equal(r.success, true)
      second = r.token
      assert.notEqual(token, second)
      assert.equal((await inspect(token, '2026-11-01T00:13:00.000Z')).viewer, 'guest')
      const current = await inspect(second, '2026-11-01T00:13:00.000Z')
      const worker = await mf.getWorker()
      assert.equal(await worker.verifyCsrf(second, current.csrf, '2026-11-01T00:13:00.000Z'), true)
      assert.equal(
        await worker.verifyCsrf(second, '0'.repeat(64), '2026-11-01T00:13:00.000Z'),
        false,
      )
      const other = await attempt({ email: env.ADMIN_EMAIL, password }, '2026-11-01T00:14:00.000Z')
      assert.equal(
        await worker.verifyCsrf(other.token, current.csrf, '2026-11-01T00:14:00.000Z'),
        false,
      )
    },
  )
  await check(
    'AUTH_VERSION, password/email changes and removed configuration invalidate prior sessions',
    async () => {
      for (const change of [
        { AUTH_VERSION: '2' },
        { ADMIN_PASSWORD: password + '-changed' },
        { AUTH_RATE_LIMIT_SECRET: randomToken() },
        { ADMIN_EMAIL: 'new@example.invalid' },
      ]) {
        const settings = await authSettings({ ...env, ...change })
        assert.equal(
          await findSession(db, second, settings, new Date('2026-11-01T00:14:00.000Z')),
          null,
        )
      }
      for (const field of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'AUTH_VERSION', 'AUTH_ORIGIN'])
        await assert.rejects(() => authSettings({ ...env, [field]: undefined }))
    },
  )
  await check(
    'rate writes and session SQL failure fail closed, leaving no partial session/binding/refund',
    async () => {
      await db.prepare('DELETE FROM login_limits').run()
      const sessions = await count('sessions'),
        bindings = await count('session_bindings')
      await db
        .prepare(
          "CREATE TRIGGER auth_fail_limits BEFORE INSERT ON login_limits WHEN (SELECT count(*) FROM login_limits)=1 BEGIN SELECT RAISE(ABORT,'TEST_LIMIT_FAILURE'); END",
        )
        .run()
      const rejected = await attempt({ email: env.ADMIN_EMAIL, password }, now)
      assert.equal(rejected.status, 503)
      assert.equal(await count('sessions'), sessions)
      assert.equal(await count('login_limits'), 0)
      await db.prepare('DROP TRIGGER auth_fail_limits').run()
      await db
        .prepare(
          "CREATE TRIGGER auth_fail_bindings BEFORE INSERT ON session_bindings BEGIN SELECT RAISE(ABORT,'TEST_SESSION_FAILURE'); END",
        )
        .run()
      assert.equal((await attempt({ email: env.ADMIN_EMAIL, password }, now)).status, 503)
      assert.equal(await count('sessions'), sessions)
      assert.equal(await count('session_bindings'), bindings)
      assert.ok(
        (await db.prepare('SELECT failures FROM login_limits').all()).results.every(
          (r) => r.failures === 1,
        ),
      )
      await db.prepare('DROP TRIGGER auth_fail_bindings').run()
    },
  )
  await check(
    'session database failure never turns into an administrator and persisted logout cannot replay',
    async () => {
      await db.prepare('DELETE FROM login_limits').run()
      const result = await attempt({ email: env.ADMIN_EMAIL, password }, '2026-11-01T00:15:00.000Z')
      const hash = await hashToken(result.token)
      await db
        .prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?')
        .bind('2026-11-01T00:16:00.000Z', hash)
        .run()
      assert.equal((await inspect(result.token, '2026-11-01T00:16:00.000Z')).viewer, 'guest')
      await db.prepare('ALTER TABLE session_bindings RENAME TO unavailable_bindings').run()
      const settings = await authSettings(env)
      await assert.rejects(() => findSession(db, result.token, settings, new Date(now)))
      await db.prepare('ALTER TABLE unavailable_bindings RENAME TO session_bindings').run()
    },
  )
  await check('dispose/restart preserves revocation, sessions and persistent limits', async () => {
    const old = { sessions: await count('sessions'), limits: await count('login_limits') }
    await mf.dispose()
    mf = new Miniflare(options)
    db = await mf.getD1Database('DB')
    assert.equal(await count('sessions'), old.sessions)
    assert.equal(await count('login_limits'), old.limits)
    assert.equal((await inspect(token, '2026-11-01T00:16:00.000Z')).viewer, 'guest')
  })
})
// Deliberately never return or write password/token material in report objects.
