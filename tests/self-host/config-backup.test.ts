// Disposable SQLite, synthetic keys and one bounded WebP fixture; no remote data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { saveAdminConfig } from '../../server/services/admin-config.ts'
import { exportConfigBackup } from '../../server/services/config-backup.ts'
import { authSettings } from '../../server/services/auth-settings.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { importCredentialKey } from '../../server/services/credentials.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { globalDefaultConfig, prepareConfigImport } from '../../shared/domain/config-backup.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { backgroundFixture } from '../fixtures/background.ts'
import {
  decodeBackgroundImage,
  backgroundImageHash,
} from '../../shared/contracts/background-image.ts'

test('configuration export, import and reset retain ciphertext/history and remain fenced by CAS and probe approval', async () => {
  const directory = await mkdtemp(resolve('.wrangler/config-backup-'))
  const db = new SqliteDatabase(resolve(directory, 'test.sqlite'))
  try {
    await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))
    const key = randomToken()
    const keys = await importCredentialKey('v1', Buffer.from(key, 'base64url'))
    const env = {
      ADMIN_EMAIL: 'fixture@example.invalid',
      ADMIN_PASSWORD: randomToken(),
      AUTH_VERSION: '1',
      AUTH_ORIGIN: 'https://dashboard.example.com',
      AUTH_RATE_LIMIT_SECRET: randomToken(),
      INTEGRATION_ENCRYPTION_KEY: key,
      INTEGRATION_KEY_VERSION: 'v1',
    }
    const session = {
      hash: 'a'.repeat(64),
      settings: await authSettings(env),
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
    const before = await readConfig(db)
    const seeded = editableConfig(before)
    const source = createIntegrationDraft('deepseek', seeded.integrations, 'fixture')
    source.enabled = true
    source.credential = { operation: 'replace', value: 'SYNTHETIC-NOT-EXPORTED' }
    seeded.integrations.push(source)
    const bytes = decodeBackgroundImage(backgroundFixture)!
    seeded.site.background.source = 'uploaded'
    seeded.site.background.url = '/api/background/' + (await backgroundImageHash(bytes))
    assert.equal(
      (
        await saveConfig(
          db,
          {
            expectedVersion: before.site.configVersion,
            config: seeded,
            backgroundUpload: backgroundFixture,
          },
          { actor: { kind: 'system' }, keys },
        )
      ).success,
      true,
    )
    await db
      .prepare(
        'INSERT INTO balance_observations(source_id,series_revision,currency,collected_at,total,granted,topped_up) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(source.id, 'fixture', 'CNY', '2026-11-07T00:00:00.000Z', '10', '0', '10')
      .run()
    const ciphertext = (
      await db
        .prepare('SELECT credential_ciphertext FROM integrations WHERE id=?')
        .bind(source.id)
        .first()
    ).credential_ciphertext
    const backup = await exportConfigBackup(db)
    assert.equal(backup.backgroundImage, backgroundFixture)
    assert.ok(!JSON.stringify(backup).includes('SYNTHETIC-NOT-EXPORTED'))
    assert.ok(!JSON.stringify(backup).includes(String(ciphertext)))
    const baseline = await readConfig(db)
    const plan = await prepareConfigImport(JSON.stringify(backup), baseline)
    plan.config.site.siteName = 'Imported fixture'
    const request = {
      expectedVersion: baseline.site.configVersion,
      config: plan.config,
      backgroundUpload: plan.backgroundUpload!.data,
    }
    const idempotency = randomUUID()
    assert.equal((await saveAdminConfig(db, request, idempotency, session, env)).success, true)
    assert.equal((await saveAdminConfig(db, request, idempotency, session, env)).replayed, true)
    assert.equal(
      (await saveAdminConfig(db, request, randomUUID(), session, env)).code,
      'CONFIG_CONFLICT',
    )
    assert.equal(
      (
        await db
          .prepare('SELECT credential_ciphertext FROM integrations WHERE id=?')
          .bind(source.id)
          .first()
      ).credential_ciphertext,
      ciphertext,
    )
    const current = await readConfig(db)
    const reset = globalDefaultConfig(current)
    const resetRequest = { expectedVersion: current.site.configVersion, config: reset }
    await db
      .prepare(
        "CREATE TRIGGER fail_reset BEFORE INSERT ON integration_audit WHEN NEW.actor_kind='admin' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END",
      )
      .run()
    assert.equal(
      (await saveAdminConfig(db, resetRequest, randomUUID(), session, env)).success,
      false,
    )
    assert.deepEqual(await readConfig(db), current)
    await db.prepare('DROP TRIGGER fail_reset').run()
    assert.equal(
      (await saveAdminConfig(db, resetRequest, randomUUID(), session, env)).success,
      true,
    )
    assert.equal((await readConfig(db)).site.siteName, 'Nozoki')
    assert.equal((await db.prepare('SELECT count(*) n FROM balance_observations').first()).n, 1)
    assert.equal((await db.prepare('SELECT count(*) n FROM site_background_images').first()).n, 0)
    assert.equal(
      (
        await db
          .prepare('SELECT credential_ciphertext FROM integrations WHERE id=?')
          .bind(source.id)
          .first()
      ).credential_ciphertext,
      ciphertext,
    )
    const latest = await readConfig(db)
    const file = await exportConfigBackup(db)
    const sleepy = createIntegrationDraft('sleepy', [], 'fixture')
    sleepy.baseUrl = 'https://new.example.com/'
    const { credential: _credential, access: _access, capabilities: _caps, ...portable } = sleepy
    file.config.integrations.push(portable)
    const incoming = await prepareConfigImport(JSON.stringify(file), latest)
    const added = incoming.config.integrations.find((s) => s.id === sleepy.id)!
    if (added.access?.mode !== 'public') throw new Error()
    added.access.approved = true
    added.access.approvedTarget = sourceTargetKey(added, added.access)
    assert.equal(
      (
        await saveAdminConfig(
          db,
          { expectedVersion: latest.site.configVersion, config: incoming.config },
          randomUUID(),
          session,
          env,
        )
      ).reason,
      'SOURCE_TEST_REQUIRED',
    )
    assert.deepEqual(await readConfig(db), latest)
  } finally {
    db.close()
  }
})
