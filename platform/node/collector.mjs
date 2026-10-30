import { fileURLToPath } from 'node:url'
import { SqliteDatabase } from './sqlite.mjs'
import { assertMigrated } from './migrations.mjs'
import { databasePath, nodeEnvironment } from './environment.mjs'
import { runCollection } from '../../server/collection/run.ts'

const db = new SqliteDatabase(databasePath())
try {
  if (process.argv.length !== 2) throw new Error('INVALID_ARGUMENTS')
  await assertMigrated(db, fileURLToPath(new URL('./migrations', import.meta.url)))
  const scheduledTime = Math.floor(Date.now() / 300000) * 300000
  const result = await runCollection(db, await nodeEnvironment(), scheduledTime)
  console.log(JSON.stringify({ kind: 'nozoki-collection', ...result }))
  if (result.fatal) process.exitCode = 1
} catch {
  console.error('COLLECTOR_UNAVAILABLE')
  process.exitCode = 1
} finally {
  db.close()
}
