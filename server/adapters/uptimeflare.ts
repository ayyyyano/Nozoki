import { z } from 'zod'
import { ADAPTER_PROTOCOLS } from '../../shared/contracts/adapter.ts'
import { cap, parse, putView, sourceResult, stampSeconds, staleAt } from './common.ts'
import type { Adapter, AdapterContext } from './types.ts'
const ResponseSchema = z
  .object({
    up: z.number().int().nonnegative(),
    down: z.number().int().nonnegative(),
    updatedAt: z.number().finite().positive(),
    monitors: z.record(
      z.string().min(1).max(400),
      z.object({
        up: z.boolean(),
        latency: z.number().finite().nonnegative().nullable().optional(),
        location: z.string().max(100).nullable().optional(),
        message: z.string().max(2000).nullable().optional(),
      }),
    ),
  })
  .refine((v) => Object.keys(v.monitors).length <= 200)
async function read(context: AdapterContext) {
  const response = await context.transport.get('api/data'),
    value = parse(ResponseSchema, response.value)
  const result = sourceResult(context, {
    status: cap(true, true),
    latency: cap(true, true),
    history: cap(false),
  })
  result.observedAt = stampSeconds(value.updatedAt)
  if (staleAt(result.observedAt, context, response.ageSeconds)) result.status = 'stale'
  const monitors = Object.entries(value.monitors).map(([id, m]) => ({
    id: context.source.id + '/' + id,
    name: id,
    state: m.up ? 'up' : 'down',
    latencyMs: m.latency ?? null,
    checkedAt: result.observedAt,
    statusPageUrl: null,
    uptimePercent: null,
    capabilities: { status: cap(true, true), latency: cap(m.latency != null, m.latency != null) },
  }))
  result.facts = {
    locations: Object.entries(value.monitors).map(([id, m]) => ({
      id,
      location: m.location ?? null,
      message: m.message ?? null,
    })),
  }
  result.items = monitors.length
  result.capabilities.status!.verified = monitors.length > 0
  result.capabilities.latency!.verified = monitors.some((m) => m.latencyMs !== null)
  putView(result, 'services', { monitors })
  return result
}
export const uptimeflare: Adapter = {
  provider: 'uptimeflare',
  versions: ADAPTER_PROTOCOLS.uptimeflare,
  expectedCapabilities: ['status', 'latency', 'history'],
  probe: read,
  read,
}
