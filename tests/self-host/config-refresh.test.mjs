import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { changedCollectionSources } from '../../server/collection/after-save.ts'
import { runCollection } from '../../server/collection/run.ts'
import { AdapterError } from '../../server/adapters/types.ts'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

test('differential quote writes, targeted refresh and repeated saves preserve retry cooldown', async () => {
  const directory = await mkdtemp(resolve('.wrangler/config-refresh-sqlite-'))
  const db = new SqliteDatabase(resolve(directory, 'test.sqlite'))
  try {
    await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))
    const save = async (edit) => {
      const current = await readConfig(db),
        config = editableConfig(current)
      edit(config)
      const result = await saveConfig(
        db,
        { expectedVersion: current.site.configVersion, config },
        { actor: { kind: 'system' } },
      )
      assert.equal(result.success, true)
    }
    const first = await readStoredState(db)
    await save((c) => {
      c.site.siteName = 'Fixture site'
      c.modules[0].title = 'Fixture title'
    })
    const afterSite = await readStoredState(db)
    assert.deepEqual(
      afterSite.integrations.map((i) => i.revision),
      first.integrations.map((i) => i.revision),
    )
    assert.deepEqual(changedCollectionSources(first, afterSite), [])
    await save((c) => {
      c.quotes[0].enabled = false
    })
    const afterQuote = await readStoredState(db)
    assert.deepEqual(changedCollectionSources(afterSite, afterQuote), ['tencent'])
    const time = Date.parse('2026-11-05T03:00:00Z'),
      env = { COLLECTOR_EPOCH: '1' }
    let requests = 0
    const reader = async () => {
      requests++
      throw new AdapterError('RATE_LIMITED', 3600)
    }
    const run = async (offset, ids) =>
      runCollection(db, env, time + offset, {
        clock: () => new Date(time + offset),
        reader,
        sourceIds: ids,
        wallBudgetMs: 20000,
      })
    assert.equal((await run(0, [])).selected, 0)
    assert.equal((await run(1, ['unrelated'])).selected, 0)
    assert.equal((await run(2, ['tencent'])).failure, 1)
    const limited = await db
      .prepare("SELECT * FROM collection_state WHERE source_id='tencent'")
      .first()
    for (let n = 0; n < 2; n++) {
      await save((c) => {
        c.quotes[1].displayName = 'Fixture name ' + n
      })
      assert.equal((await run(3 + n, ['tencent'])).selected, 0)
      const current = await db
        .prepare("SELECT * FROM collection_state WHERE source_id='tencent'")
        .first()
      assert.equal(current.next_run_at, limited.next_run_at)
      assert.equal(current.retry_after_until, limited.retry_after_until)
    }
    assert.equal(requests, 1)
    // Removing the selection really deletes it; an unrelated save does not restore it.
    await save((c) => {
      c.quotes.splice(0, 1)
    })
    await save((c) => {
      c.site.siteName = 'After removal'
    })
    assert.equal((await readConfig(db)).quotes.length, 1)
  } finally {
    db.close()
  }
})

test(
  'standalone Node retains a save-triggered task after the HTTP response',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(resolve('.wrangler/config-refresh-http-'))
    const path = resolve(directory, 'test.sqlite'),
      db = new SqliteDatabase(path)
    await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))
    db.close()
    const socket = createServer()
    await new Promise((r) => socket.listen(0, '127.0.0.1', r))
    const port = socket.address().port
    await new Promise((r) => socket.close(r))
    const origin = `http://127.0.0.1:${port}`,
      password = 'Fixture-' + crypto.randomUUID()
    const child = spawn(process.execPath, [resolve('.output-node/start.mjs')], {
      env: {
        SYSTEMROOT: process.env.SYSTEMROOT,
        PATH: process.env.PATH,
        HOST: '127.0.0.1',
        PORT: String(port),
        NOZOKI_SQLITE_PATH: path,
        ADMIN_EMAIL: 'owner@example.invalid',
        ADMIN_PASSWORD: password,
        AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'),
        AUTH_VERSION: '1',
        AUTH_ORIGIN: origin,
        AUTH_ALLOW_LOCAL_HTTP: '1',
        COLLECTOR_EPOCH: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (v) => {
      output += v
    })
    child.stderr.on('data', (v) => {
      output += v
    })
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const done = new Promise((r) => child.once('exit', r))
        child.kill('SIGTERM')
        await done
      }
    })
    for (let n = 0; !output.includes('Nozoki listening'); n++) {
      assert.ok(n < 400 && child.exitCode === null, 'Node server did not start: ' + output)
      await new Promise((r) => setTimeout(r, 50))
    }
    const login = await fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.invalid', password }),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0],
      headers = { Cookie: cookie }
    const csrf = await (await fetch(origin + '/api/auth/csrf', { headers })).json()
    const current = await (await fetch(origin + '/api/admin/config', { headers })).json(),
      config = editableConfig(current)
    // Unsupported protocol: exercise scheduling/failure persistence without contacting a vendor.
    const changed = config.integrations.find((s) => s.id === 'tencent')
    changed.protocolVersion = 'fixture-unsupported'
    changed.access.approvedTarget = sourceTargetKey(changed, changed.access)
    const saved = await fetch(origin + '/api/admin/config', {
      method: 'PUT',
      headers: {
        ...headers,
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Nozoki-CSRF': csrf.token,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ expectedVersion: current.site.configVersion, config }),
    })
    const result = await saved.json()
    assert.equal(saved.status, 200, JSON.stringify(result))
    assert.equal(result.collection, 'scheduled')
    const check = new SqliteDatabase(path)
    try {
      let row
      for (let n = 0; n < 100; n++) {
        row = await check
          .prepare("SELECT status FROM collection_state WHERE source_id='tencent'")
          .first()
        if (
          row?.status === 'error' ||
          row?.status === 'unsupported' ||
          (row?.status === 'unconfigured' && output.includes('nozoki-collection-after-save'))
        )
          break
        await new Promise((r) => setTimeout(r, 50))
      }
      assert.ok(row)
      assert.ok(output.includes('nozoki-collection-after-save'))
    } finally {
      check.close()
    }
  },
)
