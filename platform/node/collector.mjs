import { fileURLToPath } from 'node:url'
import { SqliteDatabase } from './sqlite.mjs'
import { assertMigrated } from './migrations.mjs'
import { databasePath, nodeEnvironment } from './environment.mjs'
import { collectionTick } from '../../shared/collection/cadence.ts'
import { runCollection } from '../../server/collection/run.ts'

const db = new SqliteDatabase(databasePath())
try {
  const flag = process.argv[2]
  if (process.argv.length > 3 || (flag && !['--standard', '--uptimeflare-fast'].includes(flag)))
    throw new Error('INVALID_ARGUMENTS')
  const cadence = flag === '--uptimeflare-fast' ? 'uptimeflare' : flag ? 'standard' : undefined
  await assertMigrated(db, fileURLToPath(new URL('./migrations', import.meta.url)))
  const scheduledTime = collectionTick(Date.now(), cadence ?? 'standard')
  const result = await runCollection(db, await nodeEnvironment(), scheduledTime, { cadence })
  console.log(JSON.stringify({ kind: 'nozoki-collection', ...result }))
  if (result.fatal) process.exitCode = 1
} catch {
  console.error('COLLECTOR_UNAVAILABLE')
  process.exitCode = 1
} finally {
  db.close()
}
