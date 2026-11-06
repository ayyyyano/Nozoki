import type { CollectionPlan } from './plans.ts'
import { selectedAdapter } from '../adapters/registry.ts'
import { AdapterError } from '../adapters/types.ts'
import { readManagedSource } from './managed-read.ts'
export interface ReadMetrics {
  requests: number
  responseBytes: number
}
export async function collectSource(
  p: CollectionPlan,
  env: Record<string, unknown>,
  signal: AbortSignal,
  now: Date,
  metrics: ReadMetrics,
) {
  selectedAdapter(p.source)
  if (p.source.access && p.source.access.mode !== 'legacy')
    return readManagedSource(p.source, p.envelope, p.identityEnvelope, env, now, 'read', {
      signal,
      quoteSymbols: p.quoteSymbols,
      onRead: (bytes) => {
        metrics.responseBytes += bytes
      },
      onRequest: () => {
        metrics.requests++
      },
    })
  throw new AdapterError('ACCESS_NOT_APPROVED')
}
