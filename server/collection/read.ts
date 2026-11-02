import type { CollectionPlan } from './plans.ts'
import { productionTransport } from '../adapters/transport.ts'
import { readPrivateSource } from '../adapters/private-relay.ts'
import { runAdapter, selectedAdapter } from '../adapters/registry.ts'
import { credentialKeys } from '../services/credential-keys.ts'
import { decryptCredential } from '../services/credentials.ts'
import { AdapterError } from '../adapters/types.ts'
import { publicTarget } from '../adapters/public-targets.ts'
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
  const onRead = (bytes: number) => {
    metrics.responseBytes += bytes
  }
  const target = publicTarget(p.source, env)
  if (!target) {
    const binding = env.NOZOKI_PRIVATE_RELAY as { fetch?: typeof fetch } | undefined
    const privateEnv = {
      ...env,
      ...(typeof binding?.fetch === 'function'
        ? {
            NOZOKI_PRIVATE_RELAY: {
              fetch: (...args: Parameters<typeof fetch>) => {
                metrics.requests++
                return binding.fetch!(...args)
              },
            },
          }
        : {}),
    }
    return readPrivateSource(p.source, privateEnv, 'read', now, { signal, onRead })
  }
  let secret: string | undefined
  if (target.authentication !== 'none' && !p.envelope) throw new AdapterError('AUTH_REQUIRED')
  if (target.authentication !== 'none') {
    try {
      const ring = await credentialKeys(env)
      if (!Object.hasOwn(ring.keys, p.envelope!.keyVersion)) throw new Error()
      secret = await decryptCredential(p.source.id, p.source.provider, p.envelope!, ring)
    } catch {
      throw new AdapterError('CREDENTIAL_UNAVAILABLE')
    }
  }
  try {
    const transport = productionTransport(p.source, secret, {
      quoteSymbols: p.quoteSymbols,
      environment: env,
      signal,
      onRead,
      onRequest: () => {
        metrics.requests++
      },
    })
    return await runAdapter({
      source: p.source,
      transport,
      now,
      signal,
      quoteSymbols: p.quoteSymbols,
    })
  } finally {
    secret = undefined
  }
}
