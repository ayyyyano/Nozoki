import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { prepareLocalAuth } from '../../scripts/local-debug-auth.mjs'

test('local debug setup clones real SQLite, preserves credentials and never overwrites daily data', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'nozoki-debug-setup-'))
  try {
    const directory = resolve(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
    await mkdir(directory, { recursive: true })
    const file = 'a'.repeat(64) + '.sqlite'
    const db = new DatabaseSync(resolve(directory, file))
    db.exec("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('daily')")
    db.close()
    const result = await prepareLocalAuth(root)
    const credentials = await readFile(
      resolve(root, '.wrangler/local-debug/credentials.json'),
      'utf8',
    )
    const vars = await readFile(resolve(root, '.wrangler/local-debug/.dev.vars'), 'utf8')
    assert.match(vars, /AUTH_ORIGIN=http:\/\/127\.0\.0\.1:3000/)
    assert.equal(JSON.parse(credentials).password.length, 43)
    const clone = new DatabaseSync(
      resolve(root, '.wrangler/local-debug/state/v3/d1/miniflare-D1DatabaseObject', file),
    )
    clone.exec("UPDATE marker SET value='debug'")
    clone.close()
    assert.deepEqual(await prepareLocalAuth(root), result)
    assert.equal(
      await readFile(resolve(root, '.wrangler/local-debug/credentials.json'), 'utf8'),
      credentials,
    )
    assert.equal(await readFile(resolve(root, '.wrangler/local-debug/.dev.vars'), 'utf8'), vars)
    const daily = new DatabaseSync(resolve(directory, file), { readOnly: true })
    assert.equal(daily.prepare('SELECT value FROM marker').get().value, 'daily')
    daily.close()
    await rm(resolve(root, '.wrangler/local-debug/LOGIN.txt'))
    await assert.rejects(prepareLocalAuth(root), /Partial local auth configuration/)
    assert.equal(
      await readFile(resolve(root, '.wrangler/local-debug/credentials.json'), 'utf8'),
      credentials,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('uninitialized D1 fails rather than providing an in-memory administrator', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'nozoki-debug-empty-'))
  try {
    await mkdir(resolve(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'), {
      recursive: true,
    })
    await assert.rejects(prepareLocalAuth(root), /initialized local D1/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
