import type { DataSnapshot, Device, Monitor, Quote, ServicesData } from '../contracts/dashboard.ts'
import { ITEM_HOME_LIMITS, orderedHomeItems } from './item-display.ts'

export const HOME_LIMITS = { ...ITEM_HOME_LIMITS, links: 4, quotes: 2 } as const
export function monitorName(name: unknown, fallback: string) {
  return typeof name === 'string' && name.length <= 500 ? name.trim() || fallback : fallback
}
export function monitorCode(id: string) {
  return id.slice(id.indexOf('/') + 1)
}
export function monitorLatency(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
export type ServiceSelection = { sourceId: string; monitorId: string }
export function monitorHomeIds(monitors: Pick<Monitor, 'id'>[], selected?: ServiceSelection[]) {
  if (selected === undefined) return undefined
  const visible = new Set(monitors.map((m) => m.id))
  return selected
    .filter((s) => s.monitorId.startsWith(s.sourceId + '/') && visible.has(s.monitorId))
    .map((s) => s.monitorId)
}
export function serviceSummary(snapshot: DataSnapshot<ServicesData>, now?: number) {
  const all = snapshot.data?.monitors ?? []
  const states = all.map((m) =>
    now === undefined ? m.state : monitorDisplayState(m, snapshot, now),
  )
  return {
    items: orderedHomeItems(all, snapshot.homeItems, HOME_LIMITS.services),
    total: all.length,
    down: states.filter((state) => state === 'down').length,
    unknown: states.filter((state) => ['unknown', 'pending', 'stale'].includes(state)).length,
  }
}
export function staleTime(at: string | null | undefined, now: number, lifetime: number) {
  return !!at && Number.isFinite(Date.parse(at)) && now - Date.parse(at) > lifetime
}
type MonitorSnapshot = Pick<
  DataSnapshot<ServicesData>,
  'status' | 'expiresAt' | 'collectedAt' | 'partialFailures'
>
export function monitorStale(monitor: Monitor, snapshot: MonitorSnapshot, now: number) {
  const lifetime =
    snapshot.expiresAt && snapshot.collectedAt
      ? Date.parse(snapshot.expiresAt) - Date.parse(snapshot.collectedAt)
      : 600000
  return staleTime(monitor.checkedAt, now, Math.max(60000, lifetime))
}
export function monitorDisplayState(
  monitor: Monitor,
  snapshot: MonitorSnapshot,
  now: number,
): Monitor['state'] | 'stale' {
  if (snapshot.status === 'stale' || monitorStale(monitor, snapshot, now)) return 'stale'
  if (snapshot.status !== 'ok' && !snapshot.partialFailures) return 'unknown'
  return monitor.state ?? 'unknown'
}
export function deviceSummary(devices: Device[], home?: string[]) {
  return orderedHomeItems(devices, home, HOME_LIMITS.devices)
}
export function devicesHaveDetails(devices: Device[], home?: string[]) {
  return (
    devices.length > deviceSummary(devices, home).length ||
    devices.some(
      (d) =>
        !!d.sourceName ||
        !!d.statusUpdatedAt ||
        !!d.observedAt ||
        (d.stateText?.length ?? 0) > 40 ||
        (d.foregroundApp?.length ?? 0) > 40,
    )
  )
}
export function quoteUpdates(items: Quote[], observedAt: string | null) {
  const times = items
    .map((q) => ({
      symbol: q.symbol,
      at: q.asOf ?? observedAt,
      label: q.asOf ? '报价于' : '观测于',
      delayedMinutes: q.delayedMinutes,
    }))
    .filter((t) => t.at || t.delayedMinutes !== null)
  if (!times.length)
    return observedAt ? [{ symbol: '', at: observedAt, label: '观测于', delayedMinutes: null }] : []
  const first = times[0]!
  return times.length === items.length &&
    times.every(
      (t) =>
        t.at === first.at && t.label === first.label && t.delayedMinutes === first.delayedMinutes,
    )
    ? [{ ...first, symbol: '' }]
    : times
}
export function chartPoints(quote: Quote): string | null {
  if (!Array.isArray(quote.history) || quote.history.length < 2) return null
  const values = quote.history.map((p) => Number(p.close))
  if (values.some((v) => !Number.isFinite(v))) return null
  const min = Math.min(...values),
    range = Math.max(...values) - min || 1
  return values
    .map((v, i) => `${(i / (values.length - 1)) * 240},${50 - ((v - min) / range) * 42}`)
    .join(' ')
}
export function quoteHasDetails(items: Quote[]) {
  return items.some(
    (q) =>
      q.previousClose !== null ||
      q.amplitudePercent !== null ||
      q.volume !== null ||
      q.history?.length > 0,
  )
}
