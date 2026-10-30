import { z } from 'zod'
import { ADAPTER_PROTOCOLS } from '../../shared/contracts/adapter.ts'
import { cap, parse, putView, sourceResult, stampSeconds, staleAt } from './common.ts'
import type { Adapter, AdapterContext } from './types.ts'
import { normalizeSleepyPayload } from '../../shared/device-state/sleepy.ts'
const text = z.string().max(500)
const device = z.object({
  show_name: text,
  status: z.string().max(4096).nullable().optional(),
  using: z.boolean().nullable().optional(),
  fields: z
    .object({ online: z.union([z.string().max(32), z.boolean(), z.null()]).optional() })
    .optional(),
  last_updated: z.number().finite().nonnegative(),
})
const Status = z
  .object({
    success: z.literal(true),
    time: z.number().finite().nonnegative(),
    last_updated: z.number().finite().nonnegative(),
    status: z.object({ id: z.number().int(), name: text, desc: text }),
    device: z.record(z.string().min(1).max(500), device),
  })
  .refine((v) => Object.keys(v.device).length <= 100)
export function online(value: unknown): boolean | null {
  return value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : null
}
async function probe(context: AdapterContext) {
  const { value } = await context.transport.get('api/meta')
  parse(
    z.object({
      success: z.literal(true),
      version: z.tuple([
        z.literal(5),
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
      ]),
      version_str: z.string().max(100),
      timezone: z.string().max(100),
    }),
    value,
  )
  return sourceResult(context, {
    metadata: cap(true, true),
    devices: cap(true),
    battery: cap(false),
    heartbeat: cap(false),
  })
}
async function read(context: AdapterContext) {
  const response = await context.transport.get('api/status/query'),
    value = parse(Status, response.value)
  const result = sourceResult(context, {
    devices: cap(true, true),
    battery: cap(false),
    heartbeat: cap(false),
  })
  result.observedAt = stampSeconds(value.time)
  staleAt(stampSeconds(value.last_updated), context) // last change is never a heartbeat
  // 'time' is response generation; last_updated is last change, never a heartbeat.
  if (staleAt(stampSeconds(value.time), context, response.ageSeconds)) result.status = 'stale'
  result.facts = { statusName: value.status.name, statusDescription: value.status.desc }
  const devices = normalizeSleepyPayload(value).map((d) => {
    staleAt(d.statusUpdatedAt!, context)
    return {
      ...d,
      heartbeatAt: null,
      capabilities: {
        battery: cap(d.batteryPercent !== null, d.batteryPercent !== null),
        charging: cap(false),
        usage: cap(d.using !== null, d.using !== null),
        online: cap(d.online !== null, d.online !== null),
      },
    }
  })
  result.capabilities.battery = cap(
    devices.some((d) => d.batteryPercent !== null),
    devices.some((d) => d.batteryPercent !== null),
  )
  result.items = devices.length
  putView(result, 'devices', { devices })
  return result
}
export const sleepy: Adapter = {
  provider: 'sleepy',
  versions: ADAPTER_PROTOCOLS.sleepy,
  expectedCapabilities: ['devices', 'battery', 'heartbeat'],
  probe,
  read,
}
