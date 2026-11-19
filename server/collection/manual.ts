import type { Database } from '../types/database.ts'
import { readStoredState } from '../repositories/config.ts'
import { collectionPlans } from './plans.ts'
import { runCollection } from './run.ts'

/** Cards that expose a manual "refresh now" action. Kept explicit: any module may be added later. */
export const MANUAL_REFRESH_MODULES = ['devices', 'tailscale', 'services'] as const
export type ManualRefreshModule = (typeof MANUAL_REFRESH_MODULES)[number]

export function isManualRefreshModule(value: unknown): value is ManualRefreshModule {
  return typeof value === 'string' && (MANUAL_REFRESH_MODULES as readonly string[]).includes(value)
}

/**
 * Resolve the configured sources that feed one dashboard module. Only enabled, approved
 * sources actually referenced by that module are returned, matching what collectionPlans
 * and the dashboard projection use. No source identifiers ever leave the server.
 */
export async function manualSourceIds(
  db: Database,
  moduleId: ManualRefreshModule,
): Promise<string[]> {
  const state = await readStoredState(db)
  return collectionPlans(state)
    .filter((plan) => plan.references.some((reference) => reference.moduleId === moduleId))
    .map((plan) => plan.source.id)
}

/**
 * Run one fresh collection for the given module's sources at the current time.
 * The forced run ignores each source's refresh interval but still goes through the
 * standard claim/lease/budget path in runCollection, so it cannot race a scheduled run
 * or exceed the shared request budget.
 */
export async function refreshModuleCollection(
  db: Database,
  env: Record<string, unknown>,
  moduleId: ManualRefreshModule,
) {
  const sourceIds = await manualSourceIds(db, moduleId)
  if (!sourceIds.length) {
    return { selected: 0, success: 0, failure: 0, skipped: 0, sources: 0 }
  }
  const report = await runCollection(db, env, Date.now(), {
    sourceIds,
    force: true,
  })
  return { ...report, sources: sourceIds.length }
}
