import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import type {
  DataSnapshot,
  ModuleData,
  ModuleId,
  DataStatus,
  SourceCapability,
} from '../../shared/contracts/dashboard.ts'
import type { AdapterCode } from '../../shared/contracts/adapter.ts'
import type { QuoteSymbolInput } from '../../shared/quotes/yahoo-symbol.ts'
import type { UsageDay } from './codex-usage.ts'
export class AdapterError extends Error {
  code: AdapterCode
  retryAfterSeconds?: number
  upstreamStatus?: number
  constructor(code: AdapterCode, retryAfterSeconds?: number, upstreamStatus?: number) {
    super(code)
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.upstreamStatus = upstreamStatus
  }
}
export interface ReadResponse {
  value: unknown
  ageSeconds: number | null
}
export interface ReadTransport {
  get(endpoint: string): Promise<ReadResponse>
}
export interface AdapterContext {
  identityKey?: CryptoKey
  quoteSymbols?: readonly QuoteSymbolInput[]
  codexUsageDays?: readonly UsageDay[]
  source: IntegrationSettings
  transport: ReadTransport
  now: Date
  signal?: AbortSignal
}
export type Views = Partial<{ [K in ModuleId]: DataSnapshot<ModuleData[K]> }>
export interface AdapterRead {
  sourceId: string
  provider: IntegrationSettings['provider']
  protocolVersion: string
  status: DataStatus
  capabilities: Record<string, SourceCapability>
  observedAt: string | null
  collectedAt: string
  views: Views
  items: number
  /** Aggregated deltas only; raw consuming queue records never leave the adapter. */
  usageDelta?: UsageDay[]
  code?: AdapterCode
  retryAfterSeconds?: number
  /** Recognized source facts have no existing display DTO. Server-only, never logs/probe responses. */
  facts?: {
    isAvailable?: boolean
    telemetryPublishing?: boolean
    statusName?: string
    statusDescription?: string
    locations?: { id: string; location: string | null; message: string | null }[]
  }
}
export interface Adapter {
  provider: IntegrationSettings['provider']
  versions: readonly string[]
  expectedCapabilities: readonly string[]
  probe(context: AdapterContext): Promise<AdapterRead>
  read(context: AdapterContext): Promise<AdapterRead>
}
