import type { Database } from '../types/database.ts'
import { readStoredState } from '../repositories/config.ts'
import { collectionPlans, type CollectionPlan } from './plans.ts'
import { collectionEnvironment } from './environment.ts'
import {
  syncCollectionPlans,
  dueCollectionStates,
  claimCollection,
  commitCollection,
  failCollection,
  cleanupCollection,
} from '../repositories/collection.ts'
import { collectSource, type ReadMetrics } from './read.ts'
import { collectionPayload } from './results.ts'
import { COLLECTION_BUDGET, safeCollectionCode } from '../../shared/collection/policy.ts'
import { AdapterError, type AdapterRead } from '../adapters/types.ts'
import { meterDatabase } from './metrics.ts'
import { cleanupRecords } from '../services/retention.ts'
import { requireWritableStorage } from '../repositories/storage-status.ts'
export type SourceReader = (
  p: CollectionPlan,
  env: Record<string, unknown>,
  signal: AbortSignal,
  now: Date,
  metrics: ReadMetrics,
) => Promise<AdapterRead>
/** Reader/clock injection is internal test composition, never an HTTP or environment flag. */
export async function runCollection(
  raw: Database,
  env: Record<string, unknown>,
  scheduledTime: number,
  options: {
    clock?: () => Date
    reader?: SourceReader
    sourceIds?: readonly string[]
    wallBudgetMs?: number
  } = {},
) {
  const clock = options.clock ?? (() => new Date()),
    start = clock(),
    owner = crypto.randomUUID(),
    { db, metrics } = meterDatabase(raw)
  const report = {
    selected: 0,
    success: 0,
    failure: 0,
    skipped: 0,
    maxConcurrency: 0,
    requests: 0,
    responseBytes: 0,
    wallMs: 0,
    d1: metrics,
    fatal: null as string | null,
    cleaned: false,
  }
  if (!Number.isFinite(scheduledTime) || Math.abs(start.getTime() - scheduledTime) > 86400000) {
    report.fatal = 'INVALID_SCHEDULED_TIME'
    return report
  }
  try {
    await requireWritableStorage(db)
    const environment = await collectionEnvironment(db, env),
      plans = collectionPlans(await readStoredState(db)).filter(
        (p) => !options.sourceIds || options.sourceIds.includes(p.source.id),
      )
    const budget = Math.min(25000, Math.max(0, options.wallBudgetMs ?? 25000))
    await syncCollectionPlans(db, plans, environment, start.toISOString())
    const due = await dueCollectionStates(db, start.toISOString())
    for (const prior of due) {
      const plan = plans.find((p) => p.source.id === prior.source_id)
      if (!plan) {
        report.skipped++
        continue
      }
      if (
        report.selected >= COLLECTION_BUDGET.maxSources ||
        report.requests >= COLLECTION_BUDGET.maxRequests ||
        clock().getTime() - start.getTime() >= budget
      )
        break
      const claim = await claimCollection(
        db,
        plan,
        environment,
        prior,
        clock().toISOString(),
        new Date(scheduledTime).toISOString(),
        owner,
      )
      if (!claim) {
        report.skipped++
        continue
      }
      report.selected++
      report.maxConcurrency = 1
      const stats = { requests: 0, responseBytes: 0 },
        sourceStart = Date.now(),
        controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort()
              reject(new AdapterError('TIMEOUT'))
            },
            Math.min(
              COLLECTION_BUDGET.sourceTimeoutMs,
              Math.max(1, budget - (clock().getTime() - start.getTime())),
            ),
          )
        })
        const result = await Promise.race([
          (options.reader ?? collectSource)(plan, env, controller.signal, clock(), stats),
          timeout,
        ])
        if (result.code) throw new AdapterError(result.code, result.retryAfterSeconds)
        const finishedAt = clock().toISOString(),
          payload = collectionPayload(claim, result, finishedAt)
        await commitCollection(db, claim, payload.views, payload.balances, finishedAt, {
          ...stats,
          wallMs: Date.now() - sourceStart,
          status: result.status,
        })
        report.success++
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const marker = ['SOURCE_CHANGED', 'ENVIRONMENT_CHANGED', 'LEASE_LOST', 'RESULT_OLDER'].find(
          (c) => message.includes(c),
        )
        const code =
          error instanceof AdapterError
            ? error.code
            : marker
              ? safeCollectionCode(marker)
              : 'DATABASE_ERROR'
        try {
          await failCollection(
            db,
            claim,
            code,
            clock().toISOString(),
            error instanceof AdapterError ? error.retryAfterSeconds : undefined,
            { ...stats, wallMs: Date.now() - sourceStart },
          )
        } catch {
          /* Lease expiry recovers a database outage. */
        }
        report.failure++
      } finally {
        if (timer) clearTimeout(timer)
        controller.abort()
        report.requests += stats.requests
        report.responseBytes += stats.responseBytes
      }
    }
    report.cleaned = options.sourceIds ? false : await cleanupCollection(db, clock().toISOString())
    if (report.cleaned) {
      try {
        // The collector is also the only scheduled writer. Apply the shared retention policy
        // here so expired sessions, login limits, audit rows and receipts cannot grow forever.
        await cleanupRecords(db, clock())
      } catch {
        // Collection data is already committed; retention failure must not mark the run fatal.
      }
    }
  } catch (error) {
    report.fatal =
      error instanceof Error && error.message === 'MIGRATIONS_REQUIRED'
        ? 'MIGRATIONS_REQUIRED'
        : 'COLLECTION_UNAVAILABLE'
  }
  report.wallMs = clock().getTime() - start.getTime()
  return report
}
