import type { Quote, SourceCapability } from '../../../shared/contracts/dashboard.ts'
import type { ReadTransport } from '../types.ts'
/** No licensed supplier has been selected. Registered implementations must return validated Quote DTOs. */
export interface QuoteProvider {
  id: string
  licenseReference: string
  publicDisplay: boolean
  capabilities: Record<string, SourceCapability>
  read(
    symbols: readonly { market: string; symbol: string }[],
    transport: ReadTransport,
    signal?: AbortSignal,
  ): Promise<Quote[]>
}
export const quoteProviders: ReadonlyMap<string, QuoteProvider> = new Map()
