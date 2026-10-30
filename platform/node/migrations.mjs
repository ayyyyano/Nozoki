import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

async function migrationFiles(directory) {
  const names = (await readdir(directory)).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort()
  if (!names.length) throw new Error('SQLITE_MIGRATIONS_MISSING')
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), 'utf8')
      return { name, sql, digest: createHash('sha256').update(sql).digest('hex') }
    }),
  )
}
function appliedMigrations(db) {
  const exists = db.connection
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nozoki_migrations'")
    .get()
  return exists ? db.connection.prepare('SELECT * FROM nozoki_migrations ORDER BY name').all() : []
}
function validateApplied(files, applied) {
  if (applied.some((row, i) => row.name !== files[i]?.name || row.sha256 !== files[i]?.digest))
    throw new Error('SQLITE_MIGRATION_HISTORY_MISMATCH')
}
export async function assertMigrated(db, directory) {
  const files = await migrationFiles(directory),
    applied = appliedMigrations(db)
  validateApplied(files, applied)
  if (files.length !== applied.length) throw new Error('SQLITE_MIGRATIONS_REQUIRED')
}
export async function migrateDatabase(db, directory, backupDirectory) {
  const files = await migrationFiles(directory),
    applied = appliedMigrations(db)
  validateApplied(files, applied)
  // Existing D1/foreign SQLite files need an explicit import procedure.
  if (
    !applied.length &&
    db.connection.prepare("SELECT 1 FROM sqlite_master WHERE name='site_settings'").get()
  )
    throw new Error('SQLITE_UNMANAGED_DATABASE')
  let backupPath = null
  if (applied.length && applied.length < files.length) {
    backupPath = resolve(backupDirectory, `before-migrate-${Date.now()}-${randomUUID()}.sqlite`)
    await db.backupTo(backupPath)
  }
  db.connection.exec(`CREATE TABLE IF NOT EXISTS nozoki_migrations (
    name TEXT PRIMARY KEY, sha256 TEXT NOT NULL CHECK(length(sha256)=64), applied_at TEXT NOT NULL
  ) STRICT`)
  const added = []
  for (const file of files.slice(applied.length)) {
    db.connection.exec('BEGIN IMMEDIATE')
    try {
      // Recheck after acquiring the lock when two migration processes start together.
      const prior = db.connection
        .prepare('SELECT sha256 FROM nozoki_migrations WHERE name=?')
        .get(file.name)
      if (prior && prior.sha256 !== file.digest)
        throw new Error('SQLITE_MIGRATION_HISTORY_MISMATCH')
      if (!prior) {
        db.connection.exec(file.sql)
        if (db.connection.prepare('PRAGMA foreign_key_check').all().length)
          throw new Error('SQLITE_FOREIGN_KEY_CHECK_FAILED')
        db.connection
          .prepare('INSERT INTO nozoki_migrations VALUES(?,?,?)')
          .run(file.name, file.digest, new Date().toISOString())
        added.push(file.name)
      }
      db.connection.exec('COMMIT')
    } catch (error) {
      db.connection.exec('ROLLBACK')
      throw error
    }
  }
  return { applied: added, backupPath }
}
