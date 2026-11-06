import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INTEGRATION_PRESETS,
  createIntegrationDraft,
  integrationPreset,
  presetAlreadyAdded,
  fixedPresetTarget,
  integrationWriteIssue,
  sourceReferences,
} from '../../shared/integration-presets/index.ts'
import {
  createDefaultConfig,
  IntegrationWriteSchema,
  IdSchema,
} from '../../shared/contracts/config.ts'
import { ADAPTER_PROTOCOLS } from '../../shared/contracts/adapter.ts'
import { adapters } from '../../server/adapters/registry.ts'
import { PUBLIC_SERVICES } from '../../server/adapters/public-targets.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
const stored = (draft: ReturnType<typeof createIntegrationDraft>) => {
  const { credential: _c, ...s } = draft
  return { ...s, credentialState: { configured: false, keyVersion: null, lastUpdatedAt: null } }
}
test('presets match registered adapters, approved fixed targets and material icon IDs without a new provider contract', () => {
  for (const p of INTEGRATION_PRESETS) {
    assert.ok(adapters.has(p.provider))
    assert.ok((ADAPTER_PROTOCOLS[p.provider] as readonly string[]).includes(p.protocol))
    const source = createIntegrationDraft(p.id, [], 'abc123')
    assert.ok(IntegrationWriteSchema.safeParse(source).success, p.id)
    assert.ok(IdSchema.safeParse(source.id).success)
    assert.equal(integrationPreset(source)?.id, p.id)
    assert.deepEqual(source.capabilities, {})
    assert.equal(source.access?.mode, 'public')
    if (source.access?.mode !== 'public') throw new Error()
    assert.equal(source.access.authentication, p.authentication)
    assert.equal(source.access.approved, p.roots.length > 0)
    for (const root of p.roots)
      assert.ok(
        PUBLIC_SERVICES.some(
          (s) =>
            s.provider === p.provider &&
            s.protocolVersion === p.protocol &&
            s.baseUrl === root &&
            s.authentication === p.authentication,
        ),
      )
  }
})
test('new sources have stable, collision-free IDs; singleton checks include disabled and renamed instances', () => {
  const first = createIntegrationDraft('sleepy', [], 'ABC-123')
  const copy = createIntegrationDraft('sleepy', [first], 'ABC-123')
  assert.notEqual(first.id, copy.id)
  const tencent = { ...createIntegrationDraft('tencent', [], 'x'), id: 'my-quotes', enabled: false }
  assert.equal(presetAlreadyAdded(integrationPreset(tencent)!, [tencent]), true)
  assert.throws(() => createIntegrationDraft('tencent', [tencent], 'x'))
  assert.deepEqual(tencent.capabilities, {})
  assert.equal(
    createDefaultConfig().integrations.filter((i) => integrationPreset(i)?.id === 'tencent').length,
    1,
  )
})
test('type, protocol, authentication and fixed target edits fail closed; custom targets never auto-approve', () => {
  const source = createIntegrationDraft('deepseek', [], 'one'),
    old = stored(source)
  assert.equal(integrationWriteIssue({ ...source, provider: 'sleepy' }, old), 'SOURCE_TYPE_FIXED')
  assert.equal(
    integrationWriteIssue({ ...source, protocolVersion: 'unknown' }, old),
    'SOURCE_TYPE_FIXED',
  )
  const noAuth = structuredClone(source)
  if (noAuth.access?.mode === 'public') noAuth.access.authentication = 'none'
  assert.equal(integrationWriteIssue(noAuth, old), 'SOURCE_AUTH_MISMATCH')
  assert.equal(
    integrationWriteIssue({ ...source, baseUrl: 'https://other.example.com/' }),
    'SOURCE_TARGET_FIXED',
  )
  const sleepy = createIntegrationDraft('sleepy', [], 'one')
  sleepy.baseUrl = 'https://alive.example.com/'
  assert.equal(fixedPresetTarget(sleepy), false)
  assert.equal(sleepy.access?.mode === 'public' && sleepy.access.approved, false)
  assert.equal(integrationWriteIssue(sleepy), null)
})
test('untouched legacy metadata survives and existing protected status endpoints retain their bearer binding', () => {
  const source = createIntegrationDraft('sleepy', [], 'one')
  source.baseUrl = 'https://alive.example.com/'
  if (source.access?.mode !== 'public') throw new Error()
  source.access.authentication = 'bearer'
  source.access.approved = true
  source.access.approvedTarget = sourceTargetKey(source, source.access)
  const old = stored(source)
  assert.equal(integrationWriteIssue(source), 'SOURCE_AUTH_MISMATCH')
  old.fieldMappings = { retired_hint: 'kept' }
  old.capabilities = { retired: { supported: false, verified: false } }
  source.fieldMappings = structuredClone(old.fieldMappings)
  source.capabilities = structuredClone(old.capabilities)
  assert.equal(integrationWriteIssue({ ...source, refreshInterval: 600 }, old), null)
  assert.equal(
    integrationWriteIssue({ ...source, baseUrl: 'https://changed.example.com/' }, old),
    'SOURCE_AUTH_MISMATCH',
  )
  const legacy = { ...source, protocolVersion: 'retired-v1', access: { mode: 'legacy' as const } }
  assert.equal(integrationWriteIssue(legacy, stored(legacy)), null)
  assert.equal(
    integrationWriteIssue({ ...legacy, fieldMappings: {}, capabilities: {} }),
    'SOURCE_ACCESS_REQUIRED',
  )
})
test('source deletion references include disabled modules and tickers without changing their bindings', () => {
  const config = editableConfig(createDefaultConfig()),
    prior = structuredClone(config)
  config.modules.find((m) => m.id === 'quotes')!.enabled = false
  assert.deepEqual(sourceReferences(config, 'tencent'), ['自选行情', 'QQQM', 'VOO'])
  assert.deepEqual(config.integrations, prior.integrations)
})
