import { z } from 'zod'
import { CODEX_RINGS, DISPLAY_POLICIES } from '../domain/codex-rings.ts'
import { itemDisplayFields } from './item-display.ts'

const display = z.enum(DISPLAY_POLICIES)
const ring = z.enum(CODEX_RINGS)
export const LegacyModulePresentationSchema = z.strictObject({
  tailnetName: display.optional(),
  tailnetIp: display.optional(),
  codex: z
    .strictObject({
      slots: z
        .tuple([ring, ring])
        .refine(([left, right]) => left !== right, 'Choose two different rings'),
      guest: z.record(ring, display),
    })
    .optional(),
})
export const ItemDisplaySchema = z.strictObject(itemDisplayFields)
export const ModulePresentationSchema = LegacyModulePresentationSchema.extend(itemDisplayFields)
export type ModulePresentation = z.infer<typeof ModulePresentationSchema>

export function splitModulePresentation(presentation?: ModulePresentation) {
  if (presentation === undefined) return { legacy: null, items: null }
  const { codex, tailnetIp, tailnetName, ...items } = presentation
  const legacy = Object.fromEntries(
    Object.entries({ codex, tailnetIp, tailnetName }).filter(([, value]) => value !== undefined),
  )
  return {
    legacy: Object.keys(legacy).length ? JSON.stringify(legacy) : null,
    items: Object.values(items).some((value) => value !== undefined) ? JSON.stringify(items) : null,
  }
}
