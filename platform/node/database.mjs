import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { SqliteDatabase } from './sqlite.mjs'
import { migrateDatabase } from './migrations.mjs'
import { databasePath } from './environment.mjs'

const db = new SqliteDatabase(databasePath())
try {
  const command = process.argv[2]
  if (command === 'migrate' && process.argv.length === 3) {
    const result = await migrateDatabase(
      db,
      fileURLToPath(new URL('./migrations', import.meta.url)),
      process.env.NOZOKI_BACKUP_DIR ?? resolve(dirname(db.path), 'backups'),
    )
    console.log(JSON.stringify(result))
  } else if (command === 'backup' && process.argv.length === 4) {
    await db.backupTo(process.argv[3])
    console.log('SQLite backup verified')
  } else throw new Error('USAGE: database.mjs migrate | backup ABSOLUTE_DESTINATION')
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_ :|]+$/.test(error.message)
      ? error.message
      : 'SQLITE_OPERATION_FAILED',
  )
  process.exitCode = 1
} finally {
  db.close()
}
