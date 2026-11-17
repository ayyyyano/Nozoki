import { collectionPlans } from './plans.ts'
import type { StoredState } from '../repositories/config.ts'

export function changedCollectionSources(before: StoredState, after: StoredState): string[] {
  const prior = new Map(collectionPlans(before).map((p) => [p.source.id, p.revision]))
  return collectionPlans(after)
    .filter((p) => prior.get(p.source.id) !== p.revision)
    .map((p) => p.source.id)
}
