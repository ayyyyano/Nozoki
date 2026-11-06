// Disposable SQLite and synthetic secrets; no production or upstream requests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { importCredentialKey } from '../../server/services/credentials.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import {
  createIntegrationDraft,
  integrationPreset,
} from '../../shared/integration-presets/index.ts'
import { sourceRemovalState } from '../../server/services/source-removal.ts'
const actor = { kind: 'admin', id: 'a'.repeat(64) }
test('provider form policy preserves legacy metadata and encryption; rejects type/auth/mapping forgery and protects history', async () => {
  const folder = await mkdtemp(resolve('.wrangler/source-presets-')),
    db = new SqliteDatabase(resolve(folder, 'db.sqlite'))
  try {
    await migrateDatabase(db, 'migrations', resolve(folder, 'backups'))
    const keys = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
    const input = async () => {
      const c = await readConfig(db)
      return { config: editableConfig(c), expectedVersion: c.site.configVersion }
    }
    let value = await input()
    const old = createIntegrationDraft('sleepy', value.config.integrations, 'legacy')
    old.baseUrl = 'https://old.example.com/'
    old.fieldMappings.retired_hint = 'original.path'
    old.capabilities.retired = { supported: false, verified: false }
    old.credential = { operation: 'replace', value: 'OLD-UNUSED-ENCRYPTED-KEY' }
    value.config.integrations.push(old)
    assert.equal((await saveConfig(db, value, { actor: { kind: 'system' }, keys })).success, true)
    value = await input()
    const deep = createIntegrationDraft('deepseek', value.config.integrations, 'new')
    deep.credential = { operation: 'replace', value: 'NEW-SYNTHETIC-API-KEY' }
    value.config.integrations.push(deep)
    const tencent = value.config.integrations.find((i) => integrationPreset(i)?.id === 'tencent')
    tencent.enabled = false
    assert.equal((await saveConfig(db, value, { actor, keys })).success, true)
    const prior = await readStoredState(db)
    const envelope = prior.integrations.find((i) => i.settings.id === old.id).envelope
    assert.ok(envelope.ciphertext)
    const config = await readConfig(db)
    assert.ok(!JSON.stringify(config).includes('SYNTHETIC-API-KEY'))
    assert.ok(!JSON.stringify(config).includes('ENCRYPTED-KEY'))
    assert.equal(config.integrations.find((i) => i.id === tencent.id).enabled, false)
    assert.deepEqual(
      config.integrations.find((i) => i.id === old.id).fieldMappings,
      old.fieldMappings,
    )
    assert.deepEqual(
      config.integrations.find((i) => i.id === old.id).capabilities,
      old.capabilities,
    )
    for (const [change, reason] of [
      [
        (s) => {
          s.provider = 'sleepy'
        },
        'SOURCE_TYPE_FIXED',
      ],
      [
        (s) => {
          s.protocolVersion = 'wrong'
        },
        'SOURCE_TYPE_FIXED',
      ],
      [
        (s) => {
          s.access.authentication = 'none'
        },
        'SOURCE_AUTH_MISMATCH',
      ],
      [
        (s) => {
          s.capabilities.forged = { supported: true, verified: true }
        },
        'SOURCE_CAPABILITIES_READONLY',
      ],
      [
        (s) => {
          s.fieldMappings.path = 'arbitrary'
        },
        'SOURCE_MAPPING_FIXED',
      ],
    ]) {
      const body = await input()
      change(body.config.integrations.find((s) => s.id === deep.id))
      assert.equal((await saveConfig(db, body, { actor, keys })).reason, reason)
    }
    // The older, unused credential still cannot cross an address boundary via keep.
    value = await input()
    value.config.integrations.find((i) => i.id === old.id).baseUrl = 'https://changed.example.com/'
    const denied = await saveConfig(db, value, { actor, keys })
    assert.equal(denied.success, false)
    assert.deepEqual(
      (await readStoredState(db)).integrations.find((i) => i.settings.id === old.id).envelope,
      envelope,
    )
    value = await input()
    value.config.integrations.find((i) => i.id === deep.id).credential = { operation: 'clear' }
    assert.equal((await saveConfig(db, value, { actor, keys })).success, true)
    assert.equal(
      (await readConfig(db)).integrations.find((i) => i.id === deep.id).credentialState.configured,
      false,
    )
    const info = await sourceRemovalState(db, deep.id)
    assert.deepEqual(info, { exists: true, protectedHistory: false, hasSnapshots: false })
    value = await input()
    value.config.integrations = value.config.integrations.filter((i) => i.id !== tencent.id)
    value.config.modules.find((m) => m.id === 'quotes').sources = {}
    assert.equal((await saveConfig(db, value, { actor, keys })).reason, 'SOURCE_IN_USE')
    await db
      .prepare(
        'INSERT INTO balance_observations(source_id,series_revision,currency,collected_at,total,granted,topped_up) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(deep.id, 'fixture', 'CNY', '2026-11-06T00:00:00.000Z', '10', '0', '10')
      .run()
    assert.equal((await sourceRemovalState(db, deep.id)).protectedHistory, true)
    value = await input()
    const version = value.expectedVersion
    value.config.integrations = value.config.integrations.filter((i) => i.id !== deep.id)
    assert.equal((await saveConfig(db, value, { actor, keys })).success, false)
    assert.equal((await readConfig(db)).site.configVersion, version)
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
  } finally {
    db.close()
  }
})
