import type { DataSnapshot, Device, Monitor, Quote, ServicesData } from '../contracts/dashboard.ts'

export const HOME_LIMITS = { services: 8, devices: 4, links: 4, quotes: 2 } as const
export type ServiceSelection = { sourceId: string; monitorId: string }
export function monitorHomeIds(monitors: Pick<Monitor, 'id'>[], selected?: ServiceSelection[]) {
  if (selected === undefined) return undefined
  const visible = new Set(monitors.map((m) => m.id))
  return selected
    .filter((s) => s.monitorId.startsWith(s.sourceId + '/') && visible.has(s.monitorId))
    .map((s) => s.monitorId)
}
export function serviceSummary(snapshot: DataSnapshot<ServicesData>) {
  const all = snapshot.data?.monitors ?? []
  const byId = new Map(all.map((m) => [m.id, m]))
  return {
    items:
      snapshot.homeItems === undefined
        ? all.slice(0, HOME_LIMITS.services)
        : snapshot.homeItems
            .flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
            .slice(0, HOME_LIMITS.services),
    total: all.length,
    down: all.filter((m) => m.state === 'down').length,
    unknown: all.filter((m) => m.state === 'unknown' || m.state === 'pending').length,
  }
}
export function staleTime(at: string | null | undefined, now: number, lifetime: number) {
  return !!at && Number.isFinite(Date.parse(at)) && now - Date.parse(at) > lifetime
}
export function monitorStale(monitor: Monitor, snapshot: DataSnapshot<ServicesData>, now: number) {
  const lifetime =
    snapshot.expiresAt && snapshot.collectedAt
      ? Date.parse(snapshot.expiresAt) - Date.parse(snapshot.collectedAt)
      : 600000
  return staleTime(monitor.checkedAt, now, Math.max(60000, lifetime))
}
export function deviceSummary(devices: Device[]) {
  return devices.slice(0, HOME_LIMITS.devices)
}
export function devicesHaveDetails(devices: Device[]) {
  return (
    devices.length > HOME_LIMITS.devices ||
    devices.some(
      (d) =>
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
