import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { nodeEnvironment } from '../../platform/node/environment.mjs'
import { requestURL } from '../../platform/node/http.mjs'
import { source, sleepMeta, sleepStatus } from '../fixtures/adapters.ts'
import { privateRoute, readPrivateSource } from '../../server/adapters/private-relay.ts'
import { runCollection } from '../../server/collection/run.ts'
import { saveConfig, readConfig } from '../../server/services/config.ts'
import { readGuestDashboard } from '../../server/services/dashboard.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { randomToken } from '../../server/services/auth-crypto.ts'

test('Node origin ignores forwarded headers and refuses hostile Host/absolute targets', () => {
  const env = { AUTH_ORIGIN: 'https://dashboard.example.invalid' }
  assert.equal(
    requestURL(
      {
        url: '/api/auth/session',
        headers: { host: 'dashboard.example.invalid', 'x-forwarded-proto': 'http' },
      },
      env,
    ),
    env.AUTH_ORIGIN + '/api/auth/session',
  )
  for (const url of [
    '//attacker.invalid/',
    'https://attacker.invalid/',
    '/\\attacker.invalid',
    '/\r\nheader',
  ])
    assert.throws(() => requestURL({ url, headers: { host: 'dashboard.example.invalid' } }, env))
  assert.throws(() => requestURL({ url: '/', headers: { host: 'attacker.invalid' } }, env))
  assert.equal(
    requestURL({ url: '/', headers: { host: '127.0.0.1:3000' } }, { AUTH_ORIGIN: 'invalid' }),
    'http://127.0.0.1/',
  )
})
test('embedded fixed relay feeds the same SQLite collector and enforces routes and ACL', async () => {
  const directory = await mkdtemp(resolve('.wrangler/self-host-relay-'))
  const file = resolve(directory, 'private-relay.local.json'),
    s = source('sleepy'),
    token = randomToken()
  await writeFile(file, JSON.stringify({ sources: [{ source: s }] }), { mode: 0o600 })
  let calls = 0
  const values = {
    NOZOKI_RELAY_CONFIG_FILE: file,
    NOZOKI_PRIVATE_RELAY_TOKEN: token,
    NOZOKI_PRIVATE_ROUTES: JSON.stringify([privateRoute(s)]),
    COLLECTOR_EPOCH: '1',
    COLLECTOR_BINDING_REVISION: 'node-relay-fixture-v1',
    AUTH_TRUST_CF_IP: '1',
  }
  const env = await nodeEnvironment(values, async (url, init) => {
    calls++
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.headers.Cookie, undefined)
    if (url.endsWith('/api/meta')) return Response.json(sleepMeta)
    assert.equal(url, s.baseUrl + 'api/status/query')
    const v = structuredClone(sleepStatus)
    v.time = Date.now() / 1000
    v.device['phone.a/~'].status = '[🔋66%] PRIVATE-APPLICATION'
    v.device['phone.a/~'].fields = { online: 'false' }
    return Response.json(v)
  })
  assert.equal(env.AUTH_TRUST_CF_IP, '0')
  assert.equal((await readPrivateSource(s, env, 'probe')).capabilities.metadata.verified, true)
  const before = calls
  await assert.rejects(
    readPrivateSource({ ...s, baseUrl: 'https://attacker.invalid/' }, env, 'read'),
    /TARGET_NOT_APPROVED/,
  )
  assert.equal(calls, before)
  await assert.rejects(
    readPrivateSource(s, await nodeEnvironment({}), 'read'),
    /TARGET_NOT_APPROVED/,
  )
  const db = new SqliteDatabase(resolve(directory, 'app.sqlite'))
  try {
    await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))
    const current = await readConfig(db),
      v = editableConfig(current)
    const { credentialState: _, ...settings } = s
    v.integrations = [{ ...settings, credential: { operation: 'keep' } }]
    const module = v.modules.find((m) => m.id === 'devices')
    module.visibility = 'public'
    module.sources.main = { sourceId: s.id, subject: 'main' }
    module.fields[fieldPointer(['devices', '@phone.a/~', 'stateText'])] = {
      enabled: true,
      visibility: 'admin',
    }
    assert.equal(
      (
        await saveConfig(
          db,
          { expectedVersion: current.site.configVersion, config: v },
          { actor: { kind: 'system' } },
        )
      ).success,
      true,
    )
    const result = await runCollection(db, env, Date.now())
    assert.equal(result.success, 1)
    assert.equal(result.requests, 1)
    const view = JSON.parse(
      (await db.prepare('SELECT snapshot_json FROM integration_snapshot_views').first())
        .snapshot_json,
    )
    const item = view.data.devices.find((d) => d.id === 'phone.a/~')
    assert.equal(item.batteryPercent, 66)
    assert.equal(item.online, false)
    assert.equal(item.stateText, 'PRIVATE-APPLICATION')
    const requests = calls
    assert.ok(!JSON.stringify(await readGuestDashboard(db)).includes('PRIVATE-APPLICATION'))
    assert.equal(calls, requests)
  } finally {
    db.close()
  }
})
