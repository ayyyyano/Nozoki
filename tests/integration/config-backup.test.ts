import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { authSettings } from '../../server/services/auth-settings.ts'
import { importCredentialKey, decryptCredential } from '../../server/services/credentials.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { saveAdminConfig } from '../../server/services/admin-config.ts'
import { exportConfigBackup } from '../../server/services/config-backup.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { issueSourceTestProof } from '../../server/services/source-test-proof.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { prepareConfigImport } from '../../shared/domain/config-backup.ts'
import { applyImportCredentialTest } from '../../shared/domain/import-credential-tests.ts'

const require = createRequire(import.meta.url)
const wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')

test(
  'D1 backup moves a tested credential across encryption keys without granting access',
  { timeout: 120000 },
  async () => {
    const options = convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response() } }',
      compatibilityDate: '2026-10-19',
      d1Databases: { A: 'backup-a', B: 'backup-b' },
    })
    const mf = new Miniflare(options)
    try {
      const a = await mf.getD1Database('A'),
        b = await mf.getD1Database('B')
      for (const file of (await readdir('migrations'))
        .filter((name) => name.endsWith('.sql'))
        .sort()) {
        const statements = unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8'))
        for (const db of [a, b]) await db.batch(statements.map((sql) => db.prepare(sql)))
      }
      const keyA = randomToken(),
        keyB = randomToken()
      const ringA = await importCredentialKey('a', Buffer.from(keyA, 'base64url'))
      const ringB = await importCredentialKey('b', Buffer.from(keyB, 'base64url'))
      const envA = { INTEGRATION_ENCRYPTION_KEY: keyA, INTEGRATION_KEY_VERSION: 'a' }
      const envB = {
        INTEGRATION_ENCRYPTION_KEY: keyB,
        INTEGRATION_KEY_VERSION: 'b',
        ADMIN_EMAIL: 'backup@example.invalid',
        ADMIN_PASSWORD: randomToken(),
        AUTH_VERSION: '1',
        AUTH_ORIGIN: 'https://dashboard.example.com',
        AUTH_RATE_LIMIT_SECRET: randomToken(),
      }
      const original = await readConfig(a),
        config = editableConfig(original)
      const source = createIntegrationDraft('deepseek', config.integrations, 'fixture')
      source.enabled = true
      source.credential = { operation: 'replace', value: 'synthetic-backup-secret' }
      config.integrations.push(source)
      assert.equal(
        (
          await saveConfig(
            a,
            { expectedVersion: original.site.configVersion, config },
            { actor: { kind: 'system' }, keys: ringA },
          )
        ).success,
        true,
      )
      const backup = await exportConfigBackup(a, { includeCredentials: true }, envA)
      const baseline = await readConfig(b)
      const plan = await prepareConfigImport(JSON.stringify(backup), baseline)
      const imported = plan.config.integrations.find((i) => i.id === source.id)!
      const session = {
        hash: 'a'.repeat(64),
        settings: await authSettings(envB),
        expiresAt: '2099-01-01T00:00:00.000Z',
      }
      imported.connectionProof = await issueSourceTestProof(
        imported,
        undefined,
        session,
        baseline.site.configVersion,
      )
      assert.ok(imported.connectionProof)
      assert.equal(
        (
          await saveAdminConfig(
            b,
            { expectedVersion: baseline.site.configVersion, config: plan.config },
            randomUUID(),
            session,
            envB,
          )
        ).success,
        true,
      )
      const state = await readStoredState(b)
      const stored = state.integrations.find((i) => i.settings.id === source.id)!
      assert.equal(
        await decryptCredential(source.id, source.provider, stored.envelope, ringB),
        'synthetic-backup-secret',
      )
      assert.equal(
        stored.settings.access?.mode === 'public' && stored.settings.access.approved,
        false,
      )
      assert.equal(
        collectionPlans(state).some((p) => p.source.id === source.id),
        false,
      )
      const approved = editableConfig(state.config),
        next = approved.integrations.find((i) => i.id === source.id)!
      if (next.access?.mode !== 'public') throw new Error('expected public access')
      next.access.approved = true
      next.access.approvedTarget = sourceTargetKey(next, next.access)
      assert.equal(
        (
          await saveConfig(
            b,
            { expectedVersion: state.config.site.configVersion, config: approved },
            { actor: { kind: 'system' }, keys: ringB },
          )
        ).success,
        true,
      )
      assert.equal(
        collectionPlans(await readStoredState(b)).some((p) => p.source.id === source.id),
        true,
      )
      const current = await readConfig(b)
      const failedConfig = editableConfig(current)
      const unavailable = createIntegrationDraft('sleepy', failedConfig.integrations, 'fixture')
      unavailable.baseUrl = 'https://unavailable.example.com/'
      unavailable.enabled = true
      unavailable.credential = { operation: 'replace', value: 'synthetic-unavailable' }
      failedConfig.integrations.push(applyImportCredentialTest(unavailable, { reason: 'TIMEOUT' }))
      assert.equal(
        (
          await saveAdminConfig(
            b,
            { expectedVersion: current.site.configVersion, config: failedConfig },
            randomUUID(),
            session,
            envB,
          )
        ).success,
        true,
      )
      const afterFailure = await readStoredState(b)
      const retained = afterFailure.integrations.find((i) => i.settings.id === unavailable.id)!
      assert.equal(retained.envelope, null)
      assert.equal(
        retained.settings.access?.mode === 'public' && retained.settings.access.approved,
        false,
      )
      assert.equal(
        collectionPlans(afterFailure).some((p) => p.source.id === unavailable.id),
        false,
      )
    } finally {
      await mf.dispose()
    }
  },
)
