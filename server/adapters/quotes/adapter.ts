import { ADAPTER_PROTOCOLS } from '../../../shared/contracts/adapter.ts'
import type { Adapter, AdapterContext } from '../types.ts'
import { AdapterError } from '../types.ts'
import { cap, sourceResult, putView, staleAt } from '../common.ts'
import { quoteProviders } from './index.ts'
async function read(context: AdapterContext, probe = false) {
  const provider = quoteProviders.get(context.source.protocolVersion)
  if (!provider) throw new AdapterError('UNSUPPORTED_PROTOCOL')
  const symbols = context.quoteSymbols ?? []
  const items = await provider.read(
    probe ? symbols.slice(0, 1) : symbols,
    context.transport,
    context.signal,
  )
  const result = sourceResult(context, { quote: cap(true, true) })
  for (const item of items) if (staleAt(item.asOf, context)) result.status = 'stale'
  const times = items.flatMap((item) => (item.asOf ? [item.asOf] : [])).sort()
  result.observedAt = times[0] ?? null
  result.items = items.length
  putView(result, 'quotes', {
    items: items.map((item) => ({ ...item, provider: context.source.id })),
  })
  return result
}
export const quotesAdapter: Adapter = {
  provider: 'quotes-custom',
  versions: ADAPTER_PROTOCOLS['quotes-custom'],
  expectedCapabilities: ['quote'],
  read,
  probe: (context) => read(context, true),
}
