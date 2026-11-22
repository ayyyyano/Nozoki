import { z } from 'zod'
import { ADAPTER_PROTOCOLS } from '../../shared/contracts/adapter.ts'
import { HttpsSchema } from '../../shared/contracts/config.ts'
import { cap, parse, putView, sourceResult, stampISO, staleAt } from './common.ts'
import { endpointCatalog } from './transport.ts'
import type { Adapter, AdapterContext } from './types.ts'
import { AdapterError } from './types.ts'
const Metadata = z.object({
  config: z.object({ slug: z.string().max(64), published: z.literal(true) }),
  publicGroupList: z
    .array(
      z.object({
        monitorList: z
          .array(
            z.object({
              id: z.number().int().nonnegative(),
              name: z.string().max(500),
              url: z.unknown().optional(),
            }),
          )
          .max(200),
      }),
    )
    .max(100),
})
function heartbeatState(status: number) {
  if (status === 1) return 'up' as const
  if (status === 0) return 'down' as const
  if (status === 3) return 'maintenance' as const
  return 'pending' as const
}

const Hearts = z.object({
  heartbeatList: z.record(
    z.string(),
    z
      .array(
        z.object({
          status: z.number().int().min(0).max(3),
          time: z.string().max(64),
          ping: z.number().finite().nonnegative().nullable().optional(),
        }),
      )
      .max(100),
  ),
  uptimeList: z.record(z.string(), z.number().finite().min(0).max(1)),
})
function utcTime(value: string) {
  // Kuma 2.0.2 toPublicJSON emits UTC SQL timestamps without a zone. Only this pinned profile adds Z.
  return stampISO(
    /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(value)
      ? value.replace(' ', 'T') + 'Z'
      : value,
  )
}
async function metadata(context: AdapterContext) {
  const response = await context.transport.get(endpointCatalog(context.source)[0]!)
  const value = parse(Metadata, response.value)
  if (value.config.slug !== context.source.fieldMappings.status_page_slug)
    throw new AdapterError('INVALID_RESPONSE')
  const monitors = value.publicGroupList.flatMap((g) => g.monitorList)
  if (monitors.length > 200 || new Set(monitors.map((m) => m.id)).size !== monitors.length)
    throw new AdapterError('INVALID_RESPONSE')
  return { monitors, age: response.ageSeconds }
}
async function probe(context: AdapterContext) {
  const m = await metadata(context),
    result = sourceResult(context, {
      monitors: cap(true, true),
      status: cap(true),
      latency: cap(true),
      uptime: cap(true),
      history: cap(false),
    })
  result.items = m.monitors.length
  return result
}
async function read(context: AdapterContext) {
  const meta = await metadata(context),
    response = await context.transport.get(endpointCatalog(context.source)[1]!),
    value = parse(Hearts, response.value)
  const result = sourceResult(context, {
    status: cap(true),
    latency: cap(true),
    uptime: cap(true),
    history: cap(false),
  })
  const heartbeats: NonNullable<typeof result.monitorHeartbeats> = {}
  const monitors = meta.monitors.map((m) => {
    const beats = (value.heartbeatList[String(m.id)] ?? [])
        .map((b) => ({ ...b, at: utcTime(b.time) }))
        .toSorted((a, b) => a.at.localeCompare(b.at)),
      beat = beats.at(-1)
    const id = `${context.source.id}/${context.source.fieldMappings.status_page_slug}/${m.id}`
    const points = beats.filter((b) => Date.parse(b.at) <= context.now.getTime() + 60_000)
    heartbeats[id] = Array.from(
      new Map(
        points.map((b) => [
          b.at,
          {
            at: b.at,
            state: heartbeatState(b.status),
            latencyMs: b.ping ?? null,
          },
        ]),
      ).values(),
    )
    if (beat) staleAt(beat.at, context)
    const uptime = value.uptimeList[`${m.id}_24`]
    // Kuma emits `url` (customUrl ?? url) only when the status page enables sendUrl.
    // It is the monitored target, so accept only safe HTTPS and degrade the rest:
    // putView validates statusPageUrl strictly and rejects the whole source otherwise.
    const link = HttpsSchema.safeParse(m.url)
    return {
      id,
      name: m.name,
      state: beat ? heartbeatState(beat.status) : ('pending' as const),
      latencyMs: beat?.ping ?? null,
      checkedAt: beat?.at ?? null,
      statusPageUrl: link.success ? link.data : null,
      // Preserve null when absent. The documented ratio is a measured float; no money arithmetic here.
      uptimePercent: uptime === undefined ? null : String(Number((uptime * 100).toFixed(8))),
      capabilities: {
        status: cap(true, !!beat),
        latency: cap(beat?.ping != null, beat?.ping != null),
      },
    }
  })
  const times = monitors.flatMap((m) => (m.checkedAt ? [m.checkedAt] : [])).toSorted()
  result.capabilities.status!.verified = monitors.some((m) => m.checkedAt !== null)
  result.capabilities.latency!.verified = monitors.some((m) => m.latencyMs !== null)
  result.capabilities.uptime!.verified = monitors.some((m) => m.uptimePercent !== null)
  result.observedAt = times.at(-1) ?? null
  if (
    monitors.some((m) => m.checkedAt && staleAt(m.checkedAt, context)) ||
    staleAt(null, context, Math.max(meta.age ?? 0, response.ageSeconds ?? 0))
  )
    result.status = 'stale'
  result.items = monitors.length
  result.monitorHeartbeats = heartbeats
  result.capabilities.history = cap(
    true,
    Object.values(heartbeats).some((points) => points.length),
  )
  putView(result, 'services', { monitors })
  return result
}
export const kuma: Adapter = {
  provider: 'uptime-kuma',
  versions: ADAPTER_PROTOCOLS['uptime-kuma'],
  expectedCapabilities: ['status', 'latency', 'uptime', 'history'],
  probe,
  read,
}
