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
  preference: 'fill' | 'balanced' = 'fill',
) {
  const count = Math.max(0, Math.trunc(businessCount))
  const columns = Math.min(capacity, Math.max(1, count), count === 4 ? 2 : count < 7 ? 3 : capacity)
  const remainder = count % columns
  const pairedTail =
    columns === 3 && count >= 7 && remainder === 1 && (!linksVisible || preference === 'balanced')
  const links =
    linksVisible && !pairedTail && count >= 5 && columns > 1 && remainder
      ? remainder === columns - 1
        ? ('cell' as const)
        : ('tail' as const)
      : ('strip' as const)
  const businessSpans = Array<number>(count).fill(12 / columns)
  let linksSpan = 12
  if (pairedTail) {
    businessSpans.fill(6, count - 4)
  } else if (remainder) {
    if (links !== 'strip') {
      linksSpan = 12 / (remainder + 1)
      businessSpans.fill(linksSpan, count - remainder)
    } else if (remainder > 1) {
      businessSpans.fill(12 / remainder, count - remainder)
    }
  }
  return {
    columns,
    links,
    linksSpan,
    businessSpans,
    ...(pairedTail ? { businessTail: 'pairs' as const } : {}),
  }
}
