// Isolated test entrypoint; deployment configs never reference this file.
import { WorkerEntrypoint } from 'cloudflare:workers'
import type { Database } from '../../server/types/database.ts'
import { runCollection } from '../../server/collection/run.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { collectionEnvironment } from '../../server/collection/environment.ts'
import {
  syncCollectionPlans,
  dueCollectionStates,
  claimCollection,
  commitCollection,
} from '../../server/repositories/collection.ts'
import type { CollectionClaim } from '../../server/repositories/collection.ts'
export default class Harness extends WorkerEntrypoint<Record<string, unknown> & { DB: Database }> {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === '/collect')
      return new Response(await this.collect(), { headers: { 'Content-Type': 'application/json' } })
    return new Response(null, { status: 404 })
  }
  async collect() {
    return JSON.stringify(await runCollection(this.env.DB, this.env, Date.now()))
  }
  async acquire(id: string) {
    const at = new Date().toISOString(),
      environment = await collectionEnvironment(this.env.DB, this.env),
      plans = collectionPlans(await readStoredState(this.env.DB))
    await syncCollectionPlans(this.env.DB, plans, environment, at)
    const plan = plans.find((p) => p.source.id === id),
      prior = (await dueCollectionStates(this.env.DB, at)).find((p) => p.source_id === id)
    return plan && prior
      ? JSON.stringify(
          await claimCollection(this.env.DB, plan, environment, prior, at, at, crypto.randomUUID()),
        )
      : null
  }
  async finish(raw: string) {
    try {
      await commitCollection(
        this.env.DB,
        JSON.parse(raw) as CollectionClaim,
        [],
        [],
        new Date().toISOString(),
        {},
      )
      return 'success'
    } catch (error) {
      return error instanceof Error && error.message.includes('SOURCE_CHANGED')
        ? 'SOURCE_CHANGED'
        : 'failed'
    }
  }
}
