import { normalizeDeviceState } from './types.ts'
import type { DeviceState } from './types.ts'

/** Recognize only decorations emitted by the pinned Windows/AutoX.js/Magisk clients. */
export function parseSleepyStatus(status: string | null | undefined, batteryEnabled = true) {
  const raw = status ?? null
  const number = '(\\d{1,3}(?:\\.\\d{1,6})?)'
  const prefix = batteryEnabled
    ? new RegExp('^\\[🔋' + number + '%(?:⚡)?\\](?: |$)').exec(raw ?? '')
    : null
  const suffix = batteryEnabled
    ? new RegExp('\\[' + number + '%\\](?:🔋|⚡)$').exec(raw ?? '')
    : null
  const match = prefix ?? suffix
  if (!match) return { stateText: raw, batteryPercent: null, charging: null }
  const percent = Number(match[1])
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    return { stateText: raw, batteryPercent: null, charging: null }
  const body = prefix ? raw!.slice(match[0].length) : raw!.slice(0, match.index)
  // The same glyph may mean Windows external power; it cannot establish actual charging.
  return { stateText: body || null, batteryPercent: percent, charging: null }
}
export interface SleepyDevice {
  show_name: string
  status?: string | null
  using?: boolean | null
  fields?: { online?: string | boolean | null }
}
export function normalizeSleepyDevice(
  id: string,
  device: SleepyDevice,
  observedAt: string,
  statusUpdatedAt: string,
  options: { battery?: boolean } = {},
): DeviceState {
  const online = device.fields?.online
  return normalizeDeviceState({
    id,
    name: device.show_name,
    using: device.using ?? null,
    online:
      online === true || online === 'true'
        ? true
        : online === false || online === 'false'
          ? false
          : null,
    ...parseSleepyStatus(device.status, options.battery !== false),
    // v5 fields is extensible; arbitrary field names are not a verified structured schema.
    foregroundApp: null,
    observedAt,
    statusUpdatedAt,
  })
}
function stamp(seconds: unknown): string {
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > 253402300799
  )
    throw new Error('INVALID_SLEEPY_TIME')
  return new Date(Math.round(seconds * 1000)).toISOString()
}
/** Parse a local /api/status/query JSON value without Nuxt, Zod, D1 or network access. */
export function normalizeSleepyPayload(
  value: unknown,
  options: { battery?: boolean } = {},
): DeviceState[] {
  if (!value || typeof value !== 'object') throw new Error('INVALID_SLEEPY_PAYLOAD')
  const v = value as Record<string, unknown>
  if (v.success !== true || !v.device || typeof v.device !== 'object' || Array.isArray(v.device))
    throw new Error('INVALID_SLEEPY_PAYLOAD')
  const observedAt = stamp(v.time),
    entries = Object.entries(v.device)
  if (entries.length > 100) throw new Error('TOO_MANY_SLEEPY_DEVICES')
  return entries.map(([id, raw]) => {
    if (!id || id.length > 500 || !raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('INVALID_SLEEPY_DEVICE')
    const d = raw as Record<string, unknown>
    if (
      typeof d.show_name !== 'string' ||
      d.show_name.length > 500 ||
      (d.status != null && (typeof d.status !== 'string' || d.status.length > 4096)) ||
      (d.using != null && typeof d.using !== 'boolean')
    )
      throw new Error('INVALID_SLEEPY_DEVICE')
    const fields = d.fields
    if (fields != null && (typeof fields !== 'object' || Array.isArray(fields)))
      throw new Error('INVALID_SLEEPY_FIELDS')
    const online = (fields as Record<string, unknown> | undefined)?.online
    if (online != null && typeof online !== 'string' && typeof online !== 'boolean')
      throw new Error('INVALID_SLEEPY_ONLINE')
    return normalizeSleepyDevice(
      id,
      {
        show_name: d.show_name,
        status: d.status as string | null | undefined,
        using: d.using as boolean | null | undefined,
        fields: { online: online as string | boolean | null | undefined },
      },
      observedAt,
      stamp(d.last_updated),
      options,
    )
  })
}
