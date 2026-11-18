import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { requiresSourceTest } from '../../shared/integration-presets/connection.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import {
  applyImportCredentialTest,
  planImportCredentialTests,
  summarizeImportCredentialTests,
} from '../../shared/domain/import-credential-tests.ts'

test('unapproved clear sources are allowed for new and changed targets without authorizing collection', () => {
  const source = createIntegrationDraft('deepseek', [], 'fixture')
  if (source.access?.mode !== 'public') throw new Error('expected public access')
  source.access.approved = false
  source.access.approvedTarget = null
  source.credential = { operation: 'clear' }
  assert.equal(requiresSourceTest(source), false)
  const baseline = createDefaultConfig()
  const old = {
    ...source,
    credentialState: { configured: true, keyVersion: 'v1', lastUpdatedAt: null },
  }
  source.baseUrl = 'https://changed.example.com/'
  assert.equal(requiresSourceTest(source, old), false)
  const privateSource = { ...source, access: { ...source.access, mode: 'private' as const } }
  assert.equal(requiresSourceTest(privateSource), false)
  source.credential = { operation: 'keep' }
  assert.equal(requiresSourceTest(source), true)
  assert.equal(requiresSourceTest(source, old), true)
  source.credential = { operation: 'replace', value: 'synthetic' }
  assert.equal(requiresSourceTest(source), true)
  assert.equal(requiresSourceTest(source, old), true)
  assert.equal(planImportCredentialTests([source], baseline)[0]?.needsTest, true)
  const success = applyImportCredentialTest(source, { proof: 'proof' })
  assert.equal(success.connectionProof, 'proof')
  assert.equal(success.credential.operation, 'replace')
  if (success.access?.mode !== 'public') throw new Error('expected public access')
  assert.equal(success.access.approved, true)
  assert.equal(success.access.approvedTarget, sourceTargetKey(source, success.access))
  const failed = applyImportCredentialTest(source, { reason: 'TIMEOUT' })
  assert.deepEqual(failed.credential, { operation: 'clear' })
  assert.equal(failed.access?.mode === 'public' && failed.access.approved, false)
  assert.equal(failed.connectionProof, undefined)
  assert.equal(requiresSourceTest(failed), false)
  assert.equal(planImportCredentialTests([failed], baseline)[0]?.needsTest, false)
  if (failed.access?.mode !== 'public') throw new Error('expected public access')
  failed.access.approved = true
  assert.equal(requiresSourceTest(failed), true)
  assert.deepEqual(summarizeImportCredentialTests([{ proof: 'proof' }, {}, {}]), {
    passed: 1,
    failed: 2,
  })
})
