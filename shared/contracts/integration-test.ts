import { z } from 'zod'
import { IntegrationWriteSchema, QuoteSymbolSchema } from './config.ts'

/** A bounded, one-source preview. No identity imports or arbitrary request definitions. */
export const DraftIntegrationTestSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  draft: IntegrationWriteSchema.refine(
    (s) => !s.identityCredential,
    'Identity import requires saving',
  ),
  quoteSymbols: z
    .array(QuoteSymbolSchema.pick({ market: true, symbol: true }))
    .max(1)
    .default([]),
})
export type DraftIntegrationTest = z.infer<typeof DraftIntegrationTestSchema>
