import { z } from 'zod'

const stamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
const response = z.object({
  devices: z
    .array(
      z.object({
        nodeId: z.string().min(1).max(128).optional(),
        id: z.string().min(1).max(128).optional(),
        hostname: z.string().trim().min(1).max(512).optional(),
        name: z.string().trim().min(1).max(512).optional(),
        connectedToControl: z.boolean().nullable().optional(),
        lastSeen: stamp.nullable().optional(),
        addresses: z.array(z.union([z.ipv4(), z.ipv6()])).max(10),
      }),
    )
    .max(100),
})

/** Framework-independent normalization. No battery, usage or reachability is inferred. */
export function normalizeTailscaleDevices(value: unknown) {
  const parsed = response.parse(value)
  const ids = new Set<string>()
  return parsed.devices.map((device) => {
    const id = device.nodeId ?? device.id
    if (!id || ids.has(id)) throw new Error('INVALID_DEVICE_ID')
    ids.add(id)
    return {
      id,
      name: device.hostname ?? device.name ?? '设备',
      connectedToControl: device.connectedToControl ?? null,
      lastSeen: device.lastSeen ?? null,
      addresses: [...new Set(device.addresses)],
    }
  })
}

export function tailscaleConnectionLabel(connected: boolean | null, stale: boolean) {
  return (
    (connected === true ? '在线' : connected === false ? '离线' : '状态未知') +
    (stale ? ' · 数据过期' : '')
  )
}
