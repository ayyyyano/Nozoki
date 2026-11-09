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

/** Fill a cell only when navigation completes a row. Small dashboards keep it below. */
export function dashboardPlan(
  businessCount: number,
  capacity: 1 | 2 | 3 | 4,
  linksVisible: boolean,
) {
  const count = Math.max(0, Math.trunc(businessCount))
  const columns = Math.min(capacity, Math.max(1, count), count === 4 ? 2 : count < 7 ? 3 : capacity)
  return {
    columns,
    links:
      linksVisible && count >= 5 && columns > 1 && count % columns === columns - 1
        ? ('cell' as const)
        : ('strip' as const),
  }
}
