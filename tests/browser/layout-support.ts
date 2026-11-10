export async function measure(page) {
  return page.evaluate(() => {
    const box = (e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }
    }
    const grid = document.querySelector('.dashboard-grid')
    const cards = [...grid.querySelectorAll(':scope > [data-module]')].map((e) => ({
      id: e.dataset.module,
      ...box(e),
      clientWidth: e.clientWidth,
      scrollWidth: e.scrollWidth,
      bodyHeight: e.querySelector('.module-body')?.getBoundingClientRect().height ?? null,
      rowGrowth: parseFloat(e.style.getPropertyValue('--layout-row-growth')) || 0,
      surfaceGrowth: parseFloat(e.style.getPropertyValue('--layout-surface-growth')) || 0,
      headingY: e.querySelector('.module-header h2')?.getBoundingClientRect().y ?? null,
    }))
    const list = document.querySelector('.quote-list')
    const style = getComputedStyle(grid)
    const columns = style.gridTemplateColumns
      .split(' ')
      .map(parseFloat)
      .filter((n) => n > 1)
    const columnXs = [...new Set(cards.map((c) => c.x))].sort((a, b) => a - b)
    const columnGaps = columnXs.flatMap((x) => {
      const column = cards.filter((c) => Math.abs(c.x - x) < 1).sort((a, b) => a.y - b.y)
      return column
        .slice(1)
        .map((card, i) => ({ above: column[i].id, below: card.id, gap: card.y - column[i].bottom }))
    })
    return {
      width: innerWidth,
      height: innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      grid: box(grid),
      display: getComputedStyle(grid).display,
      align: getComputedStyle(grid).alignItems,
      columns: getComputedStyle(grid).gridTemplateColumns,
      columnCount: parseInt(style.getPropertyValue('--dashboard-columns')) || columns.length,
      trackCount: columns.length,
      columnEnds: columnXs.map((x) =>
        Math.max(...cards.filter((c) => Math.abs(c.x - x) < 1).map((c) => c.bottom)),
      ),
      expectedGap: parseFloat(style.columnGap),
      columnGaps,
      topBaseline: cards.slice(0, columns.length).map((c) => c.y),
      bottomPadding: cards.length
        ? document.documentElement.scrollHeight - scrollY - Math.max(...cards.map((c) => c.bottom))
        : null,
      contentTop: getComputedStyle(document.querySelector('.dashboard-container')).paddingTop,
      scrollY,
      clientWidth: document.documentElement.clientWidth,
      gridFlow: style.gridAutoFlow,
      autoRows: style.gridAutoRows,
      quoteColumns: list && getComputedStyle(list).gridTemplateColumns,
      quoteWidth: document.querySelector('[data-module="quotes"]')?.getBoundingClientRect().width,
      cards,
      quotes: [...document.querySelectorAll('.quote-item')].map((e) => ({
        symbol: e.querySelector('h3').textContent,
        ...box(e),
        chartWidth: e.querySelector('svg')?.getBoundingClientRect().width ?? 0,
      })),
      domOrder: cards.map((c) => c.id),
      visualOrder: [...cards]
        .sort((a, b) => (Math.abs(a.y - b.y) < 1 ? a.x - b.x : a.y - b.y))
        .map((c) => c.id),
    }
  })
}

/** Fixed wallpaper is verified in scrolled viewport captures, not an expanded fullPage surface. */
export async function capture(page, path) {
  const original = await page.evaluate(() => scrollY)
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path })
  const long = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1)
  if (long) {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await page.screenshot({ path: path.replace(/\.png$/, '-bottom-viewport.png') })
  }
  await page.evaluate((y) => scrollTo(0, y), original)
}
export async function stable(page) {
  await page.waitForFunction(() => !document.querySelector('.dx-transition'))
  let prior = ''
  for (let i = 0; i < 30; i++) {
    const next = JSON.stringify((await measure(page)).cards)
    if (prior === next) return
    prior = next
    await page.waitForTimeout(60)
  }
  throw new Error('Layout did not settle')
}
