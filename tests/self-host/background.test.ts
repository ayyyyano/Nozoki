import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import {
  backgroundImageHash,
  decodeBackgroundImage,
} from '../../shared/contracts/background-image.ts'
import { backgroundFixture } from '../fixtures/background.ts'

test('shared background bytes survive SQLite reopen and reset removes only the image', async () => {
  const directory = await mkdtemp(resolve('.wrangler/background-sqlite-'))
  const path = resolve(directory, 'fixture.sqlite')
  let db = new SqliteDatabase(path)
  try {
    await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))
    const initial = await readConfig(db),
      config = editableConfig(initial)
    const bytes = decodeBackgroundImage(backgroundFixture)
    const hash = await backgroundImageHash(bytes)
    config.site.background = {
      ...config.site.background,
      source: 'uploaded',
      url: '/api/background/' + hash,
    }
    const payload = {
      config,
      expectedVersion: initial.site.configVersion,
      backgroundUpload: backgroundFixture,
    }
    assert.equal((await saveConfig(db, payload, { actor: { kind: 'system' } })).success, true)
    db.close()
    db = new SqliteDatabase(path)
    const saved = await readConfig(db)
    assert.equal(saved.site.background.url, config.site.background.url)
    const row = await db
      .prepare('SELECT data FROM site_background_images WHERE hash=?')
      .bind(hash)
      .first()
    assert.deepEqual(new Uint8Array(row.data), bytes)
    assert.equal(
      (await saveConfig(db, payload, { actor: { kind: 'system' } })).code,
      'CONFIG_CONFLICT',
    )
    const reset = editableConfig(saved)
    reset.site.background = { ...reset.site.background, source: 'builtin', url: '' }
    assert.equal(
      (
        await saveConfig(
          db,
          { config: reset, expectedVersion: saved.site.configVersion },
          { actor: { kind: 'system' } },
        )
      ).success,
      true,
    )
    assert.equal((await db.prepare('SELECT count(*) n FROM site_background_images').first()).n, 0)
    const after = await readConfig(db)
    assert.deepEqual(after.integrations, initial.integrations)
    assert.deepEqual(after.modules, initial.modules)
  } finally {
    db.close()
  }
})
