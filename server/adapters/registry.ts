import { declaredCapabilities } from './capabilities.ts'
import { deepseek } from './deepseek.ts'
import { sleepy } from './sleepy.ts'
import { cliproxy } from './cliproxyapi.ts'
import { kuma } from './uptime-kuma.ts'
import { uptimeflare } from './uptimeflare.ts'
import { quotesAdapter } from './quotes/adapter.ts'
import { AdapterError, type Adapter, type AdapterContext, type AdapterRead } from './types.ts'
import { sourceResult } from './common.ts'
export const adapters: ReadonlyMap<string, Adapter> = new Map(
  [deepseek, sleepy, cliproxy, kuma, uptimeflare, quotesAdapter].map((a) => [a.provider, a]),
)
export function selectedAdapter(source: AdapterContext['source']): Adapter {
  const adapter = adapters.get(source.provider)
  if (!adapter || !adapter.versions.includes(source.protocolVersion))
    throw new AdapterError('UNSUPPORTED_PROTOCOL')
  return adapter
}
export async function runAdapter(
  context: AdapterContext,
  mode: 'probe' | 'read' = 'read',
): Promise<AdapterRead> {
  let adapter: Adapter | undefined
  try {
    if (!context.source.enabled) throw new AdapterError('SOURCE_DISABLED')
    if (!context.source.baseUrl) throw new AdapterError('NOT_CONFIGURED')
    adapter = selectedAdapter(context.source)
    return await adapter[mode](context)
  } catch (error) {
    const e = error instanceof AdapterError ? error : new AdapterError('INVALID_RESPONSE')
    const result = sourceResult(context, declaredCapabilities(context.source.provider))
    result.status = ['UNSUPPORTED_PROTOCOL', 'TARGET_NOT_APPROVED'].includes(e.code)
      ? 'unsupported'
      : ['SOURCE_DISABLED', 'NOT_CONFIGURED'].includes(e.code)
        ? 'unconfigured'
        : 'error'
    result.code = e.code
    if (e.retryAfterSeconds) result.retryAfterSeconds = e.retryAfterSeconds
    return result
  }
}
