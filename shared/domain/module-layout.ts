/** Presentation order is independent of persisted, legacy sortOrder values. */
export const MODULE_DISPLAY_ORDER = [
  'deepseek',
  'devices',
  'tailscale',
  'codex',
  'activity',
  'quotes',
  'services',
  'links',
] as const

export function moduleRole(id: string): 'business' | 'navigation' {
  return id === 'links' ? 'navigation' : 'business'
}

export function canonicalModules<T extends { id: string; sortOrder: number }>(
  modules: readonly T[],
): T[] {
  const rank = (id: string) => {
    if (moduleRole(id) === 'navigation') return Number.MAX_SAFE_INTEGER
    const index = (MODULE_DISPLAY_ORDER as readonly string[]).indexOf(id)
    return index < 0 ? MODULE_DISPLAY_ORDER.length : index
  }
  return modules
    .toSorted((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .map((m, sortOrder) => ({ ...m, sortOrder }))
}

/** Small dashboards keep navigation below; larger ones can fill a partial final row. */
export function dashboardPlan(
  businessCount: number,
  capacity: 1 | 2 | 3 | 4,
  linksVisible: boolean,
  navigation: 'fill' | 'strip-single-tail' = 'fill',
) {
  const count = Math.max(0, Math.trunc(businessCount))
  const columns = Math.min(capacity, Math.max(1, count), count === 4 ? 2 : count < 7 ? 3 : capacity)
  const remainder = count % columns
  const compactStrip = columns === 3 && remainder === 1 && navigation === 'strip-single-tail'
  const sharesRow = linksVisible && count >= 5 && remainder > 0 && !compactStrip
  const links = sharesRow
    ? remainder === columns - 1
      ? ('cell' as const)
      : ('tail' as const)
    : ('strip' as const)
  const businessSpans = Array<number>(count).fill(12 / columns)
  const tailSpan = remainder ? 12 / (remainder + Number(sharesRow)) : 12
  if (remainder) businessSpans.fill(tailSpan, count - remainder)
  return {
    columns,
    links,
    linksSpan: sharesRow ? tailSpan : 12,
    businessSpans,
  }
}
