export const ITEM_HOME_LIMITS = { devices: 4, tailscale: 8, services: 8 } as const
export type ItemDisplayModule = keyof typeof ITEM_HOME_LIMITS

export const DEVICE_ICONS = [
  'DevicesRound',
  'SmartphoneRound',
  'TabletRound',
  'LaptopRound',
  'DesktopWindowsRound',
  'MonitorRound',
  'WatchRound',
] as const
export type DeviceIcon = (typeof DEVICE_ICONS)[number]
export const ITEM_ALIAS_LIMIT = 80

export interface ItemRef {
  sourceId: string
  itemId: string
}
export interface ItemChoice extends ItemRef {
  name: string
}

export function itemKey({ sourceId, itemId }: ItemRef) {
  return JSON.stringify([sourceId, itemId])
}

export function validDisplayAlias(value: string) {
  return (
    value.trim().length > 0 &&
    value.length <= ITEM_ALIAS_LIMIT &&
    !/[\p{Cc}\p{Bidi_Control}]/u.test(value)
  )
}

export const hasAddressText = (name: string) =>
  /(?:\d{1,3}\.){3}\d{1,3}|(?:[\da-f]*:){2,}[\da-f:.]*/i.test(name)

export function orderedHomeItems<T extends { id: string }>(
  items: T[],
  selected: readonly string[] | undefined,
  limit: number,
): T[] {
  if (selected === undefined) return items.slice(0, limit)
  const indexed = new Map(items.map((item) => [item.id, item]))
  return selected.flatMap((id) => (indexed.has(id) ? [indexed.get(id)!] : [])).slice(0, limit)
}
