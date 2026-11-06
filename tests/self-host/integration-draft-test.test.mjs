// Disposable database and synthetic protocol responses; no public network or production writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { importCredentialKey } from '../../server/services/credentials.ts'
import { hmacKey, randomToken } from '../../server/services/auth-crypto.ts'
import { testIntegrationDraft } from '../../server/services/integration-draft-test.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { balance, sleepMeta } from '../fixtures/adapters.ts'
import { tailscaleFixture, tailscaleCredentials } from '../fixtures/tailscale.ts'

test('draft probes are transient, bounded and cannot move saved secrets to a different target', async () => {
  const folder = await mkdtemp(resolve('.wrangler/draft-probe-'))
  const db = new SqliteDatabase(resolve(folder, 'db.sqlite'))
  try {
    await migrateDatabase(db, 'migrations', resolve(folder, 'backups'))
    const encryptionKey = randomToken()
    const keys = await importCredentialKey(
      'v1',
      Uint8Array.from(atob(encryptionKey.replaceAll('-', '+').replaceAll('_', '/') + '='), (c) =>
        c.charCodeAt(0),
      ),
    )
    const session = {
      settings: { email: 'fixture@example.invalid', rateKey: await hmacKey(randomToken()) },
    }
    const calls = []
    const env = {
      INTEGRATION_ENCRYPTION_KEY: encryptionKey,
      INTEGRATION_KEY_VERSION: 'v1',
      NOZOKI_CONNECTOR_TOKEN: randomToken(),
      NOZOKI_SOURCE_CONNECTOR: {
        fetch: async (req) => {
          const message = await req.json()
          calls.push(message)
          return Response.json(message.source.provider === 'deepseek' ? balance : sleepMeta)
        },
      },
    }
    const resetLimits = () => db.prepare('DELETE FROM login_limits').run()
    const body = async (draft) => ({
      draft: structuredClone(draft),
      expectedVersion: (await readConfig(db)).site.configVersion,
      quoteSymbols: [],
    })
    const invoke = async (draft) =>
      testIntegrationDraft(db, draft.id, await body(draft), session, env)
    const before = await readConfig(db)
    const tables = [
      'integration_snapshots',
      'integration_snapshot_views',
      'collection_runs',
      'integration_audit',
    ]
    const counts = await Promise.all(
      tables.map((table) => db.prepare(`SELECT count(*) n FROM ${table}`).first()),
    )
    const deep = createIntegrationDraft('deepseek', before.integrations, 'transient')
    deep.credential = { operation: 'replace', value: 'SYNTHETIC-UNSAVED-KEY' }
    assert.equal(deep.enabled, false)
    assert.equal((await invoke(deep)).protocolMatched, true)
    assert.equal(calls.at(-1).credential, 'SYNTHETIC-UNSAVED-KEY')
    assert.deepEqual(await readConfig(db), before)
    assert.deepEqual(
      await Promise.all(
        tables.map((table) => db.prepare(`SELECT count(*) n FROM ${table}`).first()),
      ),
      counts,
    )
    assert.ok(!JSON.stringify(await invoke(deep)).includes('SYNTHETIC'))
    const renamed = { ...deep, id: 'another-random-draft-id' }
    renamed.access = { ...deep.access, approvedTarget: sourceTargetKey(renamed, deep.access) }
    await assert.rejects(invoke(renamed), (e) => e.code === 'TEST_LIMITED')
    await resetLimits()

    const tailscale = createIntegrationDraft('tailscale', before.integrations, 'transient')
    tailscale.credential = { operation: 'replace', value: tailscaleCredentials }
    const oauthCalls = []
    const transientEnv = {
      NOZOKI_TAILSCALE_FETCH: async (url, init) => {
        oauthCalls.push({ url: String(url), init })
        const devices = tailscaleFixture()
        devices.devices.forEach((device) => {
          device.lastSeen = null
        })
        return oauthCalls.length === 1
          ? Response.json({
              access_token: 'synthetic-access-token',
              token_type: 'Bearer',
              expires_in: 3600,
            })
          : Response.json(devices)
      },
    }
    const oauth = await testIntegrationDraft(
      db,
      tailscale.id,
      await body(tailscale),
      session,
      transientEnv,
    )
    assert.equal(oauth.protocolMatched, true)
    assert.equal(oauthCalls.length, 2)
    assert.equal(oauthCalls[0].url, 'https://api.tailscale.com/api/v2/oauth/token')
    assert.equal(new URLSearchParams(oauthCalls[0].init.body).get('scope'), 'devices:core:read')
    assert.equal(oauthCalls[1].init.method, 'GET')
    assert.ok(!JSON.stringify(oauth).includes('clientSecret'))
    assert.deepEqual(await readConfig(db), before)
    tailscale.credential.value = JSON.stringify({ clientId: 'synthetic', clientSecret: '' })
    assert.equal(
      (await testIntegrationDraft(db, tailscale.id, await body(tailscale), session, transientEnv))
        .code,
      'CREDENTIAL_INVALID',
    )
    assert.equal(oauthCalls.length, 2)
    await resetLimits()

    // Save a protected status endpoint internally to represent an existing legacy-compatible bearer.
    const config = editableConfig(before)
    const saved = createIntegrationDraft('sleepy', config.integrations, 'saved')
    saved.baseUrl = 'https://saved.example.com/'
    saved.access.authentication = 'bearer'
    saved.access.approved = true
    saved.access.approvedTarget = sourceTargetKey(saved, saved.access)
    saved.credential = { operation: 'replace', value: 'SYNTHETIC-SAVED-KEY' }
    config.integrations.push(saved)
    assert.equal(
      (
        await saveConfig(
          db,
          { config, expectedVersion: before.site.configVersion },
          { actor: { kind: 'system' }, keys },
        )
      ).success,
      true,
    )
    const baseline = await readConfig(db)
    const old = editableConfig(baseline).integrations.find((s) => s.id === saved.id)
    old.refreshInterval = 600
    assert.equal((await invoke(old)).protocolMatched, true)
    assert.equal(calls.at(-1).credential, 'SYNTHETIC-SAVED-KEY')
    const sent = calls.length
    old.baseUrl = 'https://different.example.com/'
    old.access.approvedTarget = sourceTargetKey(old, old.access)
    await assert.rejects(invoke(old), (e) => e.code === 'SOURCE_AUTH_MISMATCH')
    assert.equal(calls.length, sent)
    const fixed = createIntegrationDraft('deepseek', baseline.integrations, 'stored')
    const nextConfig = editableConfig(baseline)
    fixed.credential = { operation: 'replace', value: 'SYNTHETIC-FIXED-KEY' }
    nextConfig.integrations.push(fixed)
    const cli = createIntegrationDraft('cliproxy', nextConfig.integrations, 'saved')
    cli.baseUrl = 'https://cli.example.com/'
    cli.access.approved = true
    cli.access.approvedTarget = sourceTargetKey(cli, cli.access)
    cli.credential = { operation: 'replace', value: 'SYNTHETIC-CLI-KEY' }
    nextConfig.integrations.push(cli)
    assert.equal(
      (
        await saveConfig(
          db,
          { config: nextConfig, expectedVersion: baseline.site.configVersion },
          { actor: { kind: 'system' }, keys },
        )
      ).success,
      true,
    )
    const latest = await readConfig(db)
    const movedCli = editableConfig(latest).integrations.find((s) => s.id === cli.id)
    movedCli.baseUrl = 'https://other-cli.example.com/'
    movedCli.access.approvedTarget = sourceTargetKey(movedCli, movedCli.access)
    assert.equal((await invoke(movedCli)).code, 'CREDENTIAL_INVALID')
    const moved = editableConfig(latest).integrations.find((s) => s.id === fixed.id)
    moved.baseUrl = 'https://evil.example.com/'
    moved.access.approvedTarget = sourceTargetKey(moved, moved.access)
    await assert.rejects(invoke(moved), (e) => e.code === 'SOURCE_TARGET_FIXED')
    assert.equal(calls.length, sent)
    await resetLimits()
    const blank = editableConfig(latest).integrations.find((s) => s.id === fixed.id)
    blank.credential = { operation: 'clear' }
    assert.equal((await invoke(blank)).code, 'AUTH_REQUIRED')
    assert.equal(calls.length, sent)
    assert.deepEqual(await readConfig(db), latest)

    for (const root of [
      'https://127.0.0.1/',
      'https://169.254.169.254/',
      'https://host.local/',
      'https://example.com/../admin/',
    ]) {
      const bad = createIntegrationDraft('sleepy', latest.integrations, 'bad')
      bad.baseUrl = root
      await assert.rejects(invoke(bad), (e) => e.code === 'INVALID_REQUEST')
    }
    const unapproved = createIntegrationDraft('sleepy', latest.integrations, 'unapproved')
    unapproved.baseUrl = 'https://source.example.com/'
    assert.equal((await invoke(unapproved)).code, 'ACCESS_NOT_APPROVED')
    const stale = await body(deep)
    stale.expectedVersion--
    await assert.rejects(
      testIntegrationDraft(db, deep.id, stale, session, env),
      (e) => e.code === 'CONFIG_CONFLICT',
    )
    const invalid = await body(deep)
    invalid.draft.credential.value = ''
    await assert.rejects(
      testIntegrationDraft(db, deep.id, invalid, session, env),
      (e) => e.code === 'INVALID_REQUEST',
    )
    assert.equal(calls.length, sent)
  } finally {
    db.close()
  }
})
