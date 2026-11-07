import { parentPort, workerData } from 'node:worker_threads'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { saveConfig } from '../../server/services/config.ts'
import { claimCollection } from '../../server/repositories/collection.ts'
const db = new SqliteDatabase(workerData.path)
parentPort.postMessage('ready')
parentPort.once('message', async () => {
  try {
    if (workerData.action === 'increments') {
      for (let i = 0; i < 25; i++)
        await db.batch([db.prepare('UPDATE concurrent_counter SET n=n+1')])
      parentPort.postMessage({ success: true })
    } else if (workerData.action === 'claim') {
      const { plan, environment, prior, now } = workerData
      parentPort.postMessage(
        await claimCollection(db, plan, environment, prior, now, now, crypto.randomUUID()),
      )
    } else
      parentPort.postMessage(await saveConfig(db, workerData.input, { actor: { kind: 'system' } }))
  } catch {
    parentPort.postMessage({ error: 'FAILED' })
  } finally {
    db.close()
  }
})
