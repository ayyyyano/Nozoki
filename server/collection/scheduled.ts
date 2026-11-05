import { runCollection } from './run.ts'
import type { Database } from '../types/database.ts'

export interface CollectionRuntime extends Record<string, unknown> {
  DB: Database
}

export async function scheduledCollection(
  controller: { scheduledTime: number },
  env: CollectionRuntime,
) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB_BINDING_MISSING')
  const metrics = await runCollection(env.DB, env, controller.scheduledTime)
  console.log(JSON.stringify({ kind: 'nozoki-collection', ...metrics }))
  if (metrics.fatal) throw new Error(metrics.fatal)
}
