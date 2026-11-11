import { z } from 'zod'
import { CODEX_RINGS, DISPLAY_POLICIES } from '../domain/codex-rings.ts'

const display = z.enum(DISPLAY_POLICIES)
const ring = z.enum(CODEX_RINGS)
export const ModulePresentationSchema = z.strictObject({
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
export type ModulePresentation = z.infer<typeof ModulePresentationSchema>
