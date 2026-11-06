import { collectionPlans } from './plans.ts'
import { runCollection } from './run.ts'
import type { StoredState } from '../repositories/config.ts'
import type { Database } from '../types/database.ts'

export function changedCollectionSources(before: StoredState, after: StoredState): string[] {
  const prior = new Map(collectionPlans(before).map((p) => [p.source.id, p.revision]))
  return collectionPlans(after)
    .filter((p) => prior.get(p.source.id) !== p.revision)
    .map((p) => p.source.id)
}

export async function collectAfterSave(
  db: Database,
  env: Record<string, unknown>,
  sourceIds: readonly string[],
) {
  if (!sourceIds.length) return
  try {
    // Leave headroom inside the HTTP background lifetime. Cron recovers unfinished work.
    const report = await runCollection(db, env, Date.now(), { sourceIds, wallBudgetMs: 20000 })
    console.log(JSON.stringify({ kind: 'nozoki-collection-after-save', ...report }))
  } catch {
    // Persistence already succeeded. Never turn a background failure into a save failure.
    console.error('COLLECTION_AFTER_SAVE_UNAVAILABLE')
  }
}
