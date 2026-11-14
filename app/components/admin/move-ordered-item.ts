export function moveOrderedItem<T extends { sortOrder: number }>(
  items: T[],
  index: number,
  offset: number,
) {
  const target = index + offset
  if (target < 0 || target >= items.length) return
  ;[items[index], items[target]] = [items[target]!, items[index]!]
  items.forEach((item, i) => (item.sortOrder = i))
}
