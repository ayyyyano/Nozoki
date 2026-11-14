// Synthetic credentials and protocol replies on isolated SQLite; no real upstream writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { testIntegrationDraft } from '../../server/services/integration-draft-test.ts'
import { saveAdminConfig } from '../../server/services/admin-config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { importCredentialKey, decryptCredential } from '../../server/services/credentials.ts'
import { hmacKey, randomToken, mac, hex } from '../../server/services/auth-crypto.ts'
import { authSettings } from '../../server/services/auth-settings.ts'
import { readManagedSource } from '../../server/collection/managed-read.ts'
import { tailscaleFixture, tailscaleCredentials } from '../fixtures/tailscale.ts'

async function fresh(legacy = false) {
  const folder = await mkdtemp(resolve('.wrangler/source-migration-'))
  const db = new SqliteDatabase(resolve(folder, 'test.sqlite'))
  if (legacy) {
    for (const name of (await readdir('migrations'))
      .filter((f) => f.endsWith('.sql') && f < '0019')
      .sort())
      db.connection.exec(await readFile('migrations/' + name, 'utf8'))
    // This fixture isolates the 0019 source-grant migration; display schema is current.
    db.connection.exec(await readFile('migrations/0020_balance_display.sql', 'utf8'))
    db.connection.exec(await readFile('migrations/0022_home_services.sql', 'utf8'))
    db.connection.exec(await readFile('migrations/0024_module_presentation.sql', 'utf8'))
    db.connection.exec(await readFile('migrations/0025_item_display.sql', 'utf8'))
  } else await migrateDatabase(db, 'migrations', resolve(folder, 'backups'))
  return db
}
function approved(id, provider, protocolVersion, baseUrl, authentication) {
  const source = {
    id,
    provider,
    protocolVersion,
    baseUrl,
    enabled: true,
    refreshInterval: 300,
    fieldMappings: {},
    capabilities: {},
    credential: { operation: 'keep' },
    access: { mode: 'public', authentication, approved: true, approvedTarget: null },
  }
  source.access.approvedTarget = sourceTargetKey(source, source.access)
  return source
}
const input = (c) => ({ config: editableConfig(c), expectedVersion: c.site.configVersion })

test('exact legacy targets migrate atomically, preserving ciphertext, references, observations and cooldown', async () => {
  const db = await fresh(true)
  try {
    const keys = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
    let value = input(await readConfig(db))
    const deep = approved(
      'deep-fixture',
      'deepseek',
      'deepseek-balance-v1',
      'https://api.deepseek.com/',
      'bearer',
    )
    deep.access = { mode: 'legacy' }
    deep.credential = { operation: 'replace', value: 'SYNTHETIC-DO-NOT-USE' }
    const unknown = {
      ...deep,
      id: 'unknown-fixture',
      provider: 'sleepy',
      protocolVersion: 'sleepy-v5-status',
      baseUrl: 'https://sleepy.example.com/',
      credential: { operation: 'keep' },
    }
    value.config.integrations.push(deep, unknown)
    assert.equal((await saveConfig(db, value, { actor: { kind: 'system' }, keys })).success, true)
    const before = await readStoredState(db)
    const source = before.integrations.find((i) => i.settings.id === deep.id)
    const at = '2026-11-06T00:00:00.000Z',
      retry = '2026-11-07T00:00:00.000Z'
    await db
      .prepare('INSERT INTO integration_snapshots(source_id,subject,updated_at) VALUES(?,?,?)')
      .bind(deep.id, 'default', at)
      .run()
    await db
      .prepare(
        'INSERT INTO integration_snapshot_views(source_id,subject,module_id,snapshot_json,updated_at,source_revision) VALUES(?,?,?,?,?,?)',
      )
      .bind(deep.id, 'default', 'deepseek', '{}', at, source.revision)
      .run()
    await db
      .prepare(
        "INSERT INTO collection_state(source_id,source_revision,environment_epoch,next_run_at,retry_after_until,failures,status,error_code) VALUES(?,?,1,?,?,7,'error','RATE_LIMITED')",
      )
      .bind(deep.id, source.revision, retry, retry)
      .run()
    const refs = (await db.prepare('SELECT * FROM quote_symbols').all()).results
    const modules = (await db.prepare('SELECT * FROM dashboard_modules').all()).results
    const sql = await readFile('migrations/0019_public_sources.sql', 'utf8')
    db.connection.exec('BEGIN IMMEDIATE')
    db.connection.exec(
      "CREATE TRIGGER reject_fixture BEFORE INSERT ON integration_audit WHEN NEW.id='migration-0019-public-sources' BEGIN SELECT RAISE(ABORT,'INJECTED'); END",
    )
    assert.throws(() => db.connection.exec(sql), /INJECTED/)
    db.connection.exec('ROLLBACK')
    assert.deepEqual((await readStoredState(db)).integrations, before.integrations)
    db.connection.exec('BEGIN IMMEDIATE')
    db.connection.exec(sql)
    db.connection.exec('COMMIT')
    const after = await readStoredState(db),
      migrated = after.integrations.find((i) => i.settings.id === deep.id)
    assert.equal(after.config.site.configVersion, before.config.site.configVersion + 1)
    assert.deepEqual(migrated.envelope, source.envelope)
    assert.equal(
      await decryptCredential(deep.id, deep.provider, migrated.envelope, keys),
      'SYNTHETIC-DO-NOT-USE',
    )
    assert.equal(
      migrated.settings.access.approvedTarget,
      sourceTargetKey(migrated.settings, migrated.settings.access),
    )
    assert.deepEqual(after.integrations.find((i) => i.settings.id === unknown.id).settings.access, {
      mode: 'legacy',
    })
    assert.equal(
      (
        await db
          .prepare('SELECT status FROM source_access_migrations WHERE source_id=?')
          .bind(unknown.id)
          .first()
      ).status,
      'review',
    )
    assert.deepEqual((await db.prepare('SELECT * FROM quote_symbols').all()).results, refs)
    assert.deepEqual((await db.prepare('SELECT * FROM dashboard_modules').all()).results, modules)
    const view = await db
      .prepare('SELECT * FROM integration_snapshot_views WHERE source_id=?')
      .bind(deep.id)
      .first()
    assert.equal(view.source_revision, migrated.revision)
    assert.equal(view.updated_at, at)
    assert.equal(view.snapshot_json, '{}')
    const state = await db
      .prepare('SELECT * FROM collection_state WHERE source_id=?')
      .bind(deep.id)
      .first()
    assert.equal(state.retry_after_until, retry)
    assert.equal(state.failures, 7)
    assert.equal(state.source_revision, migrated.revision)
    assert.equal(
      (await saveConfig(db, input(before.config), { actor: { kind: 'system' } })).code,
      'CONFIG_CONFLICT',
    )
    const unchanged = await readStoredState(db)
    assert.equal(
      (await saveConfig(db, input(unchanged.config), { actor: { kind: 'system' } })).success,
      true,
    )
    // Materializing derived module references may advance collection revisions, never secrets.
    const withoutRevision = ({ revision: _revision, ...source }) => source
    assert.deepEqual(
      (await readStoredState(db)).integrations.map(withoutRevision),
      unchanged.integrations.map(withoutRevision),
    )
  } finally {
    db.close()
  }
})

test('Codex old identity import proves account ACL matches, encrypts both keys and survives reload/idempotency', async () => {
  const db = await fresh()
  try {
    const env = {
      ADMIN_EMAIL: 'fixture@example.invalid',
      ADMIN_PASSWORD: 'SYNTHETIC-' + randomToken(),
      AUTH_VERSION: '1',
      AUTH_ORIGIN: 'https://dashboard.example.com',
      AUTH_RATE_LIMIT_SECRET: randomToken(),
      INTEGRATION_ENCRYPTION_KEY: randomToken(),
      INTEGRATION_KEY_VERSION: 'v1',
      NOZOKI_CONNECTOR_TOKEN: randomToken(),
    }
    const session = {
      hash: 'a'.repeat(64),
      settings: await authSettings(env),
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
    const identity = randomToken(),
      id = 'codex-fixture'
    const accountId = hex(
      await mac(await hmacKey(identity), ['nozoki-codex-account-v1', id, 'old-raw-id']),
    )
    let calls = 0
    env.NOZOKI_SOURCE_CONNECTOR = {
      fetch: async (request) => {
        calls++
        const body = await request.json()
        if (body.endpoint === 'v8/management/observability/usage/queue?count=50')
          return new Response(null, { status: 404 })
        assert.equal(body.credential, 'SYNTHETIC-MANAGEMENT')
        assert.equal(body.endpoint, 'v8/management/credentials')
        assert.ok(!JSON.stringify(body).includes(identity))
        return Response.json({
          files: [{ provider: 'codex', auth_index: 'old-raw-id', status: 'ready' }],
        })
      },
    }
    let value = input(await readConfig(db))
    const codex = approved(
      id,
      'cliproxy-bridge',
      'cliproxy-v8-accounts',
      'https://codex.example.com/',
      'bearer',
    )
    value.config.integrations.push({ ...codex, access: { mode: 'legacy' }, enabled: false })
    const module = value.config.modules.find((m) => m.id === 'codex')
    module.sources.main = { sourceId: id, subject: 'default' }
    module.fields['/accounts/@' + accountId + '/state'] = { enabled: false, visibility: 'admin' }
    assert.equal((await saveConfig(db, value, { actor: { kind: 'system' } })).success, true)
    value = input(await readConfig(db))
    const migrated = {
      ...codex,
      credential: { operation: 'replace', value: 'SYNTHETIC-MANAGEMENT' },
      identityCredential: { operation: 'import', value: randomToken() },
    }
    value.config.integrations[value.config.integrations.findIndex((i) => i.id === id)] = migrated
    const before = await readConfig(db)
    const { identityCredential: _identity, ...draft } = migrated
    const probe = await testIntegrationDraft(
      db,
      id,
      { expectedVersion: value.expectedVersion, draft, quoteSymbols: [] },
      session,
      env,
    )
    assert.equal(probe.protocolMatched, true)
    migrated.connectionProof = probe.connectionProof
    assert.equal(
      (await saveAdminConfig(db, value, randomUUID(), session, env)).reason,
      'IDENTITY_IMPORT_UNVERIFIED',
    )
    assert.deepEqual(await readConfig(db), before)
    migrated.identityCredential.value = identity
    const key = randomUUID()
    assert.equal((await saveAdminConfig(db, value, key, session, env)).success, true)
    assert.equal((await saveAdminConfig(db, value, key, session, env)).success, true)
    assert.equal(calls, 3)
    const state = await readStoredState(db),
      record = state.integrations.find((i) => i.settings.id === id)
    assert.equal(state.config.integrations.find((i) => i.id === id).identityConfigured, true)
    assert.deepEqual(
      state.config.modules.find((m) => m.id === 'codex').fields,
      before.modules.find((m) => m.id === 'codex').fields,
    )
    assert.ok(!JSON.stringify(state.config).includes(identity))
    assert.ok(!JSON.stringify(record).includes('SYNTHETIC-MANAGEMENT'))
    const ring = await importCredentialKey(
      'v1',
      Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64url'),
    )
    assert.equal(
      await decryptCredential(id, 'cliproxy-bridge:identity', record.identityEnvelope, ring),
      identity,
    )
    const read = await readManagedSource(
      state.config.integrations.find((i) => i.id === id),
      record.envelope,
      record.identityEnvelope,
      env,
      new Date(),
      'read',
    )
    assert.equal(read.views.codex.data.accounts[0].id, accountId)
    value = input(state.config)
    value.config.integrations.find((i) => i.id === id).identityCredential = {
      operation: 'import',
      value: randomToken(),
    }
    assert.equal((await saveAdminConfig(db, value, randomUUID(), session, env)).success, false)
    // Reusing the source ID across providers must not silently rotate its account identity.
    value = input(await readConfig(db))
    const changed = value.config.integrations.find((i) => i.id === id)
    changed.provider = 'sleepy'
    changed.protocolVersion = 'sleepy-v5-status'
    changed.credential = { operation: 'clear' }
    changed.access.approvedTarget = sourceTargetKey(changed, changed.access)
    assert.equal((await saveConfig(db, value, { actor: { kind: 'system' } })).success, true)
    value = input(await readConfig(db))
    const restored = value.config.integrations.find((i) => i.id === id)
    restored.provider = 'cliproxy-bridge'
    restored.protocolVersion = 'cliproxy-v8-accounts'
    restored.credential = { operation: 'replace', value: 'SYNTHETIC-MANAGEMENT' }
    restored.access.approvedTarget = sourceTargetKey(restored, restored.access)
    assert.equal(
      (await saveConfig(db, value, { actor: { kind: 'system' }, keys: ring })).success,
      true,
    )
    assert.deepEqual(
      (await readStoredState(db)).integrations.find((i) => i.settings.id === id).identityEnvelope,
      record.identityEnvelope,
    )
  } finally {
    db.close()
  }
})

test('managed Tailscale validates credentials, exchanges only at official endpoints and retains masked metadata', async () => {
  const db = await fresh()
  try {
    const secret = randomToken(),
      keys = await importCredentialKey('v1', Buffer.from(secret, 'base64url'))
    let value = input(await readConfig(db))
    const source = approved(
      'tail-fixture',
      'tailscale',
      'tailscale-devices-v2',
      'https://api.tailscale.com/',
      'tailscale-oauth',
    )
    source.credential = { operation: 'replace', value: 'bad' }
    value.config.integrations.push(source)
    assert.equal((await saveConfig(db, value, { actor: { kind: 'system' }, keys })).success, false)
    source.credential.value = tailscaleCredentials
    assert.equal((await saveConfig(db, value, { actor: { kind: 'system' }, keys })).success, true)
    const state = await readStoredState(db),
      record = state.integrations.find((i) => i.settings.id === source.id)
    let calls = 0
    const env = {
      INTEGRATION_ENCRYPTION_KEY: secret,
      INTEGRATION_KEY_VERSION: 'v1',
      NOZOKI_TAILSCALE_FETCH: async (url, init) => {
        calls++
        assert.equal(new URL(url).origin, 'https://api.tailscale.com')
        if (init.method === 'POST') {
          assert.equal(init.headers.Authorization, undefined)
          assert.equal(new URLSearchParams(init.body).get('scope'), 'devices:core:read')
          return Response.json({
            access_token: 'SYNTHETIC-ACCESS',
            token_type: 'Bearer',
            expires_in: 3600,
          })
        }
        assert.equal(init.headers.Authorization, 'Bearer SYNTHETIC-ACCESS')
        return Response.json(tailscaleFixture())
      },
    }
    const s = state.config.integrations.find((i) => i.id === source.id)
    assert.ok(
      (await readManagedSource(s, record.envelope, null, env, new Date(), 'read')).views.tailscale,
    )
    assert.equal(calls, 2)
    for (const changed of [
      { ...s, baseUrl: 'https://other.example.com/' },
      { ...s, access: { ...s.access, approved: false } },
    ])
      await assert.rejects(
        readManagedSource(changed, record.envelope, null, env, new Date(), 'read'),
        /ACCESS_NOT_APPROVED/,
      )
    assert.equal(calls, 2)
    assert.ok(!JSON.stringify(state.config).includes('synthetic-secret'))
  } finally {
    db.close()
  }
})
