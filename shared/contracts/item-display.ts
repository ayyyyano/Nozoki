import { z } from 'zod'
import {
  DEVICE_ICONS,
  ITEM_HOME_LIMITS,
  hasAddressText,
  itemKey,
  validDisplayAlias,
} from '../domain/item-display.ts'

const sourceId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const stableId = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((id) => id.trim().length > 0 && !/\p{Cc}/u.test(id))
const itemRef = { sourceId, itemId: stableId(500) }
const alias = z
  .string()
  .refine(validDisplayAlias, 'Invalid display alias')
  .transform((s) => s.trim())
const tailnetAlias = z.strictObject({
  ...itemRef,
  alias: alias.refine((name) => !hasAddressText(name), 'Node alias cannot contain an IP address'),
})
const deviceItem = z
  .strictObject({ ...itemRef, alias: alias.optional(), icon: z.enum(DEVICE_ICONS).optional() })
  .refine((item) => item.alias !== undefined || item.icon !== undefined)
const serviceAlias = z
  .strictObject({ sourceId, itemId: stableId(1024), alias })
  .refine(
    ({ sourceId, itemId }) =>
      itemId.startsWith(sourceId + '/') && itemId.length > sourceId.length + 1,
  )

function distinct<T extends z.ZodType<{ sourceId: string; itemId: string }>>(
  schema: T,
  max: number,
) {
  return z
    .array(schema)
    .max(max)
    .refine((items) => new Set(items.map(itemKey)).size === items.length, 'Duplicate display item')
}

export const itemDisplayFields = {
  deviceHome: distinct(z.strictObject(itemRef), ITEM_HOME_LIMITS.devices).optional(),
  tailnetHome: distinct(z.strictObject(itemRef), ITEM_HOME_LIMITS.tailscale).optional(),
  deviceOverrides: distinct(deviceItem, 100).optional(),
  tailnetAliases: distinct(tailnetAlias, 100).optional(),
  serviceAliases: distinct(serviceAlias, 200).optional(),
}
