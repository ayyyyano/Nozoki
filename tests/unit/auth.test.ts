import test from 'node:test'
import assert from 'node:assert/strict'
import { authSettings } from '../../server/services/auth-settings.ts'
import { bytes, mac, randomToken, hashToken, verifyMac } from '../../server/services/auth-crypto.ts'
import { LoginSchema } from '../../server/services/auth.ts'
const env = {
  ADMIN_EMAIL: 'Owner@Example.invalid',
  ADMIN_PASSWORD: 'SYNTHETIC-' + crypto.randomUUID(),
  AUTH_RATE_LIMIT_SECRET: randomToken(),
  AUTH_VERSION: '1',
  AUTH_ORIGIN: 'https://dashboard.example.invalid',
}
test('auth configuration has no default administrator and rejects unsafe HTTP origins', async () => {
  for (const key of [
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
    'AUTH_VERSION',
    'AUTH_ORIGIN',
    'AUTH_RATE_LIMIT_SECRET',
  ])
    await assert.rejects(() => authSettings({ ...env, [key]: undefined }))
  for (const change of [
    { AUTH_ORIGIN: 'http://dashboard.example.invalid', AUTH_ALLOW_LOCAL_HTTP: '1' },
    { AUTH_ORIGIN: 'https://dashboard.example.invalid/path' },
    { AUTH_VERSION: '0' },
    { AUTH_VERSION: '1.0' },
    { ADMIN_PASSWORD: 'REPLACE_WITH_A_LOCAL_DEVELOPMENT_PASSWORD' },
  ])
    await assert.rejects(() => authSettings({ ...env, ...change }))
  assert.equal(
    (
      await authSettings({
        ...env,
        AUTH_ORIGIN: 'http://127.0.0.1:3000',
        AUTH_ALLOW_LOCAL_HTTP: '1',
      })
    ).local,
    true,
  )
  assert.equal((await authSettings({ ...env, AUTH_ALLOW_LOCAL_HTTP: '1' })).local, false)
})
test('password and email use native HMAC verification without an email shortcut', async () => {
  const settings = await authSettings(env),
    signature = settings.credentialTag
  for (const [email, password, expected] of [
    [settings.email, env.ADMIN_PASSWORD, true],
    ['wrong@example.invalid', env.ADMIN_PASSWORD, false],
    [settings.email, 'wrong', false],
    [settings.email, env.ADMIN_PASSWORD + '\u0000', false],
  ] as const) {
    assert.equal(
      await crypto.subtle.verify(
        'HMAC',
        settings.rateKey,
        signature,
        bytes(JSON.stringify(['nozoki-password-check-v1', email, password])),
      ),
      expected,
    )
  }
})
test('tokens are random 256-bit opaque values and only their digest is suitable for storage', async () => {
  const a = randomToken(),
    b = randomToken()
  assert.match(a, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a, b)
  assert.match(await hashToken(a), /^[a-f0-9]{64}$/)
  assert.notEqual(await hashToken(a), a)
})
test('identity and CSRF domain separation bind configuration and session', async () => {
  const settings = await authSettings(env),
    parts = ['nozoki-csrf-v1', 'session-a', settings.fingerprint],
    signature = await mac(settings.rateKey, parts)
  assert.equal(await verifyMac(settings.rateKey, parts, new Uint8Array(signature)), true)
  assert.equal(
    await verifyMac(
      settings.rateKey,
      ['nozoki-csrf-v1', 'session-b', settings.fingerprint],
      new Uint8Array(signature),
    ),
    false,
  )
  assert.notEqual(
    (await authSettings({ ...env, AUTH_VERSION: '2' })).fingerprint,
    settings.fingerprint,
  )
  assert.notEqual(
    (await authSettings({ ...env, ADMIN_PASSWORD: env.ADMIN_PASSWORD + 'x' })).fingerprint,
    settings.fingerprint,
  )
})
test('login inputs normalize account case and reject type confusion and overlong secrets', () => {
  assert.equal(
    LoginSchema.parse({ email: ' OWNER@EXAMPLE.INVALID ', password: 'x' }).email,
    'owner@example.invalid',
  )
  for (const body of [
    { email: 12, password: 'x' },
    { email: 'owner', password: null },
    { email: 'owner', password: 'x'.repeat(1025) },
    { email: 'owner', password: 'x', role: 'admin' },
  ])
    assert.equal(LoginSchema.safeParse(body).success, false)
})
test('limiter uses an independent random Secret rather than a password-derived key', async () => {
  const a = await authSettings(env),
    b = await authSettings({ ...env, ADMIN_PASSWORD: env.ADMIN_PASSWORD + '-changed' })
  const signature = await mac(a.rateKey, ['limit', 'owner'])
  assert.equal(await verifyMac(b.rateKey, ['limit', 'owner'], new Uint8Array(signature)), true)
  assert.notEqual(a.fingerprint, b.fingerprint)
})
