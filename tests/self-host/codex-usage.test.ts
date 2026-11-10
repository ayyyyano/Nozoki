import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { setupUsageConfig } from '../fixtures/codex-usage-config.ts'
import { usageRecord } from '../fixtures/codex-usage.ts'
import { runCollection } from '../../server/collection/run.ts'
import { readCodexUsageDays } from '../../server/repositories/codex-usage.ts'

test('SQLite keeps aggregate history across database reopen, enforces constraints and expires old days', async () => {
  const folder = await mkdtemp(resolve('.wrangler/codex-usage-node-')),
    path = resolve(folder, 'test.sqlite')
  let db = new SqliteDatabase(path),
    at = Date.now()
  const record = usageRecord(new Date(at - 86400000).toISOString())
  let queue = [record]
  const env = {
    COLLECTOR_EPOCH: '1',
    INTEGRATION_ENCRYPTION_KEY: randomToken(),
    INTEGRATION_KEY_VERSION: 'v1',
    NOZOKI_CONNECTOR_TOKEN: randomToken(),
    NOZOKI_SOURCE_CONNECTOR: {
      fetch: async (request: Request) => {
        const body = await request.json()
        if (body.endpoint.endsWith('/usage/queue?count=50')) {
          const batch = queue
          queue = []
          return Response.json(batch)
        }
        assert.equal(body.endpoint, 'v8/management/credentials')
        return Response.json({
          observed_at: new Date(at).toISOString(),
          files: [{ provider: 'codex', auth_index: 'a1' }],
        })
      },
    },
  }
  try {
    await migrateDatabase(db, 'migrations', resolve(folder, 'backups'))
    await setupUsageConfig(db, env)
    const collect = async () => {
      const report = await runCollection(db, env, at, {
        clock: () => new Date(at),
        sourceIds: ['usage-fixture'],
      })
      assert.equal(report.success, 1)
    }
    await collect()
    db.close()
    db = new SqliteDatabase(path)
    at += 600000
    queue = [record]
    await collect()
    const [usage] = await readCodexUsageDays(db, 'usage-fixture', new Date(at))
    assert.equal(usage.total, 240)
    assert.equal(usage.requests, 2)
    await assert.rejects(db.prepare('UPDATE codex_usage_days SET total=9007199254740992').run())
    await assert.rejects(db.prepare('UPDATE codex_usage_days SET failed=requests+1').run())
    await assert.rejects(db.prepare("UPDATE codex_usage_days SET day='2026-02-30'").run())
    assert.equal((await readCodexUsageDays(db, 'usage-fixture', new Date(at)))[0].total, 240)
    at += 401 * 86400000
    await collect()
    assert.deepEqual(await readCodexUsageDays(db, 'usage-fixture', new Date(at)), [])
    assert.equal((await db.prepare('SELECT count(*) n FROM codex_usage_days').first()).n, 0)
  } finally {
    db.close()
  }
})
