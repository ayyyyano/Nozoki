import { runCollection } from '../../server/collection/run.ts'
import type { Database } from '../../server/types/database.ts'
interface Environment extends Record<string, unknown> {
  DB: Database
}
export default {
  async scheduled(controller: { scheduledTime: number }, env: Environment) {
    if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('DB_BINDING_MISSING')
    const metrics = await runCollection(env.DB, env, controller.scheduledTime)
    console.log(JSON.stringify({ kind: 'nozoki-collection', ...metrics }))
    if (metrics.fatal) throw new Error(metrics.fatal)
  },
  fetch() {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  },
}
