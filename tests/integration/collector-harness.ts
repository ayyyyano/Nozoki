// Isolated test RPC only. No deployment config references this entrypoint.
import { WorkerEntrypoint } from 'cloudflare:workers'
import type { Database } from '../../server/types/database.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { collectionEnvironment } from '../../server/collection/environment.ts'
import {
  syncCollectionPlans,
  dueCollectionStates,
  claimCollection,
  commitCollection,
  failCollection,
} from '../../server/repositories/collection.ts'
import type { CollectionClaim } from '../../server/repositories/collection.ts'
import { runCollection } from '../../server/collection/run.ts'
import { collectionPayload } from '../../server/collection/results.ts'
import { responseTransport } from '../../server/adapters/transport.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { AdapterError } from '../../server/adapters/types.ts'
import type { AdapterRead } from '../../server/adapters/types.ts'
import { sleepyDevicesFixture } from '../fixtures/devices0511.ts'
import { balance } from '../fixtures/adapters.ts'
import { snapshot, unavailableCapability } from '../../shared/domain/dashboard.ts'
interface Env extends Record<string, unknown> {
  DB: Database
}
async function fixture(
  plan: CollectionClaim['plan'],
  now: Date,
  multi = false,
  changedBalance = false,
): Promise<AdapterRead> {
  const payload = sleepyDevicesFixture()
  payload.time = now.getTime() / 1000
  payload.last_updated = payload.time
  const balanceValue = structuredClone(balance)
  if (changedBalance) {
    balanceValue.balance_infos[0]!.total_balance = '109.000000000000000001'
    balanceValue.balance_infos[0]!.topped_up_balance = '99.000000000000000001'
  }
  const result = await runAdapter({
    source: plan.source,
    now,
    transport: responseTransport(plan.source, async () =>
      Response.json(plan.source.provider === 'deepseek' ? balanceValue : payload),
    ),
  })
  if (multi) {
    const codex = snapshot(
      'ok',
      {
        usage: null,
        quota: null,
        estimatedCost: null,
        capabilities: {
          usage: unavailableCapability(),
          quota: unavailableCapability(),
          estimatedCost: unavailableCapability(),
        },
      },
      plan.source.id,
    )
    codex.collectedAt = now.toISOString()
    codex.observedAt = now.toISOString()
    result.views.codex = codex
  }
  return result
}
export default class Harness extends WorkerEntrypoint<Env> {
  fetch() {
    return new Response('Test RPC only', { status: 404 })
  }
  async acquire(at: number, id: string) {
    const date = new Date(at),
      e = await collectionEnvironment(this.env.DB, this.env),
      plans = collectionPlans(await readStoredState(this.env.DB))
    await syncCollectionPlans(this.env.DB, plans, e, date.toISOString())
    const p = plans.find((p) => p.source.id === id),
      prior = (await dueCollectionStates(this.env.DB, date.toISOString())).find(
        (s) => s.source_id === id,
      )
    if (!p || !prior) return null
    return JSON.stringify(
      await claimCollection(
        this.env.DB,
        p,
        e,
        prior,
        date.toISOString(),
        date.toISOString(),
        crypto.randomUUID(),
      ),
    )
  }
  async finish(raw: string, at: number, older?: string, multi = false) {
    const c = JSON.parse(raw) as CollectionClaim,
      now = new Date(at)
    try {
      const result = await fixture(c.plan, now, multi)
      if (older) {
        result.observedAt = older
        for (const v of Object.values(result.views)) if (v) v.observedAt = older
      }
      const payload = collectionPayload(c, result, now.toISOString())
      await commitCollection(this.env.DB, c, payload.views, payload.balances, now.toISOString(), {
        fixture: true,
      })
      return 'success'
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      return (
        ['SOURCE_CHANGED', 'LEASE_LOST', 'RESULT_OLDER', 'ENVIRONMENT_CHANGED'].find((c) =>
          message.includes(c),
        ) ?? 'DATABASE_ERROR'
      )
    }
  }
  async run(at: number, mode = 'ok') {
    return JSON.stringify(
      await runCollection(this.env.DB, this.env, at, {
        clock: () => new Date(at),
        reader: async (p, _env, _signal, now, metrics) => {
          metrics.requests++
          if (mode === 'auth' || (mode === 'fail-one' && p.source.id.startsWith('a')))
            throw new AdapterError('AUTH_REQUIRED')
          if (mode === 'rate') throw new AdapterError('RATE_LIMITED', 3600)
          if (mode === 'hang') return new Promise<AdapterRead>(() => {})
          return fixture(p, now, mode === 'multi', mode === 'changed-balance')
        },
      }),
    )
  }
  async fail(raw: string, at: number) {
    await failCollection(
      this.env.DB,
      JSON.parse(raw),
      'DATABASE_ERROR',
      new Date(at).toISOString(),
      undefined,
      { fixture: true },
    )
  }
}
