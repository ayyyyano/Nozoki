import test from 'node:test'
import assert from 'node:assert/strict'
import { managedServiceRoot, sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { assertManagedSource, connectorTransport } from '../../server/adapters/source-connector.ts'
import { source } from '../fixtures/adapters.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { isIntegrationConfigured } from '../../server/services/credentials.ts'

test('managed roots reject URL escapes and public local/IP targets', () => {
  assert.equal(
    managedServiceRoot('https://EXAMPLE.com/service', 'public'),
    'https://example.com/service/',
  )
  for (const value of [
    'http://example.com/',
    'https://user:pass@example.com/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://foo.internal/',
    'https://localhost/',
    'https://example.com:8443/',
    'https://example.com/a/../b',
    'https://example.com/%2e/',
    'https://example.com/?x=1',
    'https://example.com/#x',
    'https://example.com/a\\b',
  ])
    assert.throws(() => managedServiceRoot(value, 'public'), value)
  assert.equal(managedServiceRoot('https://10.20.0.2/', 'private'), 'https://10.20.0.2/')
})
test('approval binds exact identity, protocol, root, network scope and authentication', () => {
  const s = source('sleepy')
  s.baseUrl = 'https://sleepy.example.com/service/'
  s.access = { mode: 'public', authentication: 'none', approved: true, approvedTarget: null }
  s.access.approvedTarget = sourceTargetKey(s, s.access)
  assert.equal(assertManagedSource(s).mode, 'public')
  for (const changed of [
    { ...s, id: 'other' },
    { ...s, baseUrl: 'https://other.example.com/' },
    { ...s, protocolVersion: 'other' },
    { ...s, access: { ...s.access, authentication: 'bearer' as const } },
    { ...s, access: { ...s.access, mode: 'private' as const } },
    { ...s, access: { ...s.access, approved: false } },
  ])
    assert.throws(() => assertManagedSource(changed), /ACCESS_NOT_APPROVED/)
  assertManagedSource({ ...s, refreshInterval: 600, fieldMappings: { label: 'name' } })
})
test('unapproved source and missing connector never perform an outbound request; none drops credentials', async () => {
  const s = source('sleepy')
  s.baseUrl = 'https://sleepy.example.com/'
  s.access = { mode: 'public', authentication: 'none', approved: true, approvedTarget: null }
  s.access.approvedTarget = sourceTargetKey(s, s.access)
  assert.throws(() => connectorTransport(s, undefined, {}), /CONNECTOR_UNAVAILABLE/)
  let calls = 0
  const env = {
    NOZOKI_CONNECTOR_TOKEN: randomToken(),
    NOZOKI_SOURCE_CONNECTOR: {
      fetch: async (request: Request) => {
        calls++
        assert.equal(request.method, 'POST')
        assert.equal(request.headers.get('authorization'), null)
        const body = (await request.json()) as Record<string, unknown>
        assert.equal(body.credential, undefined)
        return Response.json({ ok: true })
      },
    },
  }
  await connectorTransport(s, 'MUST-NOT-LEAVE', env).get('api/meta')
  assert.equal(calls, 1)
  assert.throws(
    () => connectorTransport({ ...s, access: { ...s.access, approved: false } }, undefined, env),
    /ACCESS_NOT_APPROVED/,
  )
  assert.equal(calls, 1)
})

test('managed completeness follows the saved authentication and exact grant, including keyless proxies', () => {
  const s = source('deepseek')
  s.baseUrl = 'https://balance.example.com/'
  s.access = { mode: 'public', authentication: 'none', approved: true, approvedTarget: null }
  s.access.approvedTarget = sourceTargetKey(s, s.access)
  assert.equal(isIntegrationConfigured(s), true)
  assert.equal(isIntegrationConfigured({ ...s, baseUrl: 'https://changed.example.com/' }), false)
  s.access.authentication = 'bearer'
  s.access.approvedTarget = sourceTargetKey(s, s.access)
  assert.equal(isIntegrationConfigured(s), false)
  s.credentialState.configured = true
  assert.equal(isIntegrationConfigured(s), true)
})
