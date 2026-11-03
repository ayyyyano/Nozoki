/** Native sparse Grid keeps DOM order while observed content heights set row spans. */
export function observeNaturalGrid(grid: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const heights = new Map<HTMLElement, number>()
  const fittedHeights = new Map<HTMLElement, number>()
  const growth = new Map<HTMLElement, { property: string; value: string; total: number }>()
  let resetFit = true
  let frame = 0
  let inlineSize = -1
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(layout)
  }
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === grid) {
        const width = entry.contentRect.width
        if (width !== inlineSize) {
          inlineSize = width
          resetFit = true
          queue()
        }
      } else {
        const card = entry.target as HTMLElement
        const height = entry.borderBoxSize[0]?.blockSize ?? card.getBoundingClientRect().height
        if (card.dataset.layoutFlexible) {
          if (Math.abs(height - (fittedHeights.get(card) ?? -1)) > 0.1) {
            if (card.dataset.layoutFlexible === 'surface')
              heights.set(card, height - (growth.get(card)?.total ?? 0))
            queue()
          }
          continue
        }
        if (heights.has(card) && heights.get(card) !== height) {
          heights.set(card, height)
          queue()
        }
      }
    }
  })
  function layout() {
    frame = 0
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0
    const flexible = [...heights.keys()].filter((card) => card.dataset.layoutFlexible)
    for (const card of flexible) {
      card.style.removeProperty('--layout-row-growth')
      card.style.removeProperty('--layout-surface-growth')
    }
    for (const card of flexible.filter((c) => c.dataset.layoutFlexible === 'rows'))
      heights.set(card, card.getBoundingClientRect().height)
    for (const [card, height] of heights) {
      const span = `span ${Math.max(1, Math.ceil(height + gap))}`
      if (card.style.gridRowEnd !== span) card.style.gridRowEnd = span
    }
    if (heights.size) grid.dataset.packed = 'true'
    else delete grid.dataset.packed
    fitColumnEnds(flexible, gap)
    resetFit = false
    for (const card of flexible) fittedHeights.set(card, card.getBoundingClientRect().height)
  }
  function fitColumnEnds(flexible: HTMLElement[], gap: number) {
    if (!flexible.length) return
    const positions = [...heights].map(([card, height]) => ({
      card,
      height,
      left: card.offsetLeft,
      top: card.offsetTop,
    }))
    const columns = [...new Set(positions.map((p) => p.left))]
    if (columns.length < 2) {
      growth.clear()
      return
    }
    if (!resetFit && grid.querySelector('details[open]')) {
      // Expanding details keeps unrelated cards at their existing fitted sizes.
      for (const [card, fit] of growth) {
        card.style.setProperty(fit.property, fit.value)
        card.style.gridRowEnd = `span ${Math.ceil(heights.get(card)! + fit.total + gap)}`
      }
      return
    }
    growth.clear()
    const ends = columns.map((left) =>
      Math.max(...positions.filter((p) => p.left === left).map((p) => p.top + p.height)),
    )
    const end = Math.max(...ends)
    const fittedColumns = new Set<number>()
    const preferred = [...flexible].sort((a, b) =>
      a.dataset.layoutFlexible === b.dataset.layoutFlexible
        ? positions.findIndex((p) => p.card === b) - positions.findIndex((p) => p.card === a)
        : a.dataset.layoutFlexible === 'rows'
          ? -1
          : 1,
    )
    for (const card of preferred) {
      const position = positions.find((p) => p.card === card)!
      if (fittedColumns.has(position.left)) continue
      const extra = end - ends[columns.indexOf(position.left)]!
      if (
        card.dataset.layoutFlexible === 'surface' &&
        Math.abs(position.top + position.height - ends[columns.indexOf(position.left)]!) > 1
      )
        continue
      // Absorb small end differences; tall content must keep its natural flow.
      if (extra < 1 || extra > Math.min(120, position.height / 2)) continue
      let property = '--layout-surface-growth',
        value = `${extra}px`
      if (card.dataset.layoutFlexible === 'rows') {
        const rows = card.querySelector<HTMLElement>('[data-layout-rows]')
        if (!rows?.children.length) continue
        const count = getComputedStyle(rows).gridTemplateRows.split(' ').length
        property = '--layout-row-growth'
        value = `${extra / count}px`
      }
      card.style.setProperty(property, value)
      card.style.gridRowEnd = `span ${Math.ceil(position.height + extra + gap)}`
      // Growing a card must not move another module into a different column.
      if (positions.some((p) => p.card.offsetLeft !== p.left)) {
        card.style.removeProperty(property)
        card.style.gridRowEnd = `span ${Math.ceil(position.height + gap)}`
      } else {
        fittedColumns.add(position.left)
        growth.set(card, { property, value, total: extra })
      }
    }
  }
  function sync() {
    const cards = new Set(
      [...grid.children].filter((child): child is HTMLElement => child instanceof HTMLElement),
    )
    for (const card of heights.keys())
      if (!cards.has(card)) {
        resize.unobserve(card)
        card.style.removeProperty('grid-row-end')
        heights.delete(card)
        fittedHeights.delete(card)
        growth.delete(card)
        card.style.removeProperty('--layout-row-growth')
        card.style.removeProperty('--layout-surface-growth')
      }
    for (const card of cards)
      if (!heights.has(card)) {
        heights.set(card, card.getBoundingClientRect().height)
        resize.observe(card, { box: 'border-box' })
      }
    resetFit = true
    queue()
  }
  const mutations = new MutationObserver(sync)
  mutations.observe(grid, { childList: true })
  resize.observe(grid)
  sync()
  return () => {
    mutations.disconnect()
    resize.disconnect()
    cancelAnimationFrame(frame)
    for (const card of heights.keys()) {
      card.style.removeProperty('grid-row-end')
      card.style.removeProperty('--layout-row-growth')
      card.style.removeProperty('--layout-surface-growth')
    }
    delete grid.dataset.packed
    heights.clear()
    fittedHeights.clear()
    growth.clear()
  }
}
