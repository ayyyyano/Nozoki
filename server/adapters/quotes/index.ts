import type { Quote, SourceCapability } from '../../../shared/contracts/dashboard.ts'
import type { ReadTransport } from '../types.ts'
import { yahooChart } from './yahoo-chart.ts'
/** publicDisplay records confirmed display rights; false means those rights are unconfirmed. */
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
export const quoteProviders: ReadonlyMap<string, QuoteProvider> = new Map([
  [yahooChart.id, yahooChart],
])
