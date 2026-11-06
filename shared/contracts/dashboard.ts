import type { DeviceState } from '../device-state/types.ts'
export const MODULE_IDS = [
  'deepseek',
  'devices',
  'tailscale',
  'codex',
  'activity',
  'quotes',
  'links',
  'services',
] as const
export type ModuleId = (typeof MODULE_IDS)[number]
export type Role = 'guest' | 'admin'
export type DataStatus = 'ok' | 'stale' | 'error' | 'unconfigured' | 'unsupported' | 'offline'
export type SourceCapability = { supported: boolean; verified: boolean; reason?: string }
export interface DataSnapshot<T> {
  status: DataStatus
  data: T | null
  sourceId: string
  observedAt: string | null
  collectedAt: string | null
  lastSuccessAt: string | null
  expiresAt: string | null
  errorCode?: string
  collection?: {
    status: DataStatus
    errorCode: string | null
    lastAttemptAt: string | null
    nextRunAt: string
  }
}
export type Decimal = string
export interface ModuleConfig {
  id: ModuleId
  title: string
  enabled: boolean
  sortOrder: number
  visibility: 'public' | 'admin'
  guestBehavior: 'hidden' | 'login_hint'
  fields: Record<string, { enabled: boolean; visibility: 'public' | 'admin' }>
  ipVisibility?: 'public' | 'hidden' | 'admin'
  guestBlur?: boolean
}
export interface DeepSeekData {
  balances: { currency: string; total: Decimal; toppedUp: Decimal; granted: Decimal }[]
  dailyBalances: { day: string; currency: string; total: Decimal; collectedAt: string }[]
  timezone?: string
  masked?: boolean
  capabilities: { balance: SourceCapability }
}
export interface Device extends DeviceState {
  heartbeatAt: string | null
  capabilities: Record<string, SourceCapability>
}
export interface DevicesData {
  devices: Device[]
}
export interface TailscaleData {
  devices: {
    id: string
    name: string
    connectedToControl: boolean | null
    lastSeen: string | null
    addresses: string[]
    addressesHidden?: boolean
  }[]
}
export interface CodexData {
  accounts?: {
    id: string
    provider: 'codex'
    state:
      | 'ready'
      | 'disabled'
      | 'auth_error'
      | 'error'
      | 'cooldown'
      | 'unavailable'
      | 'pending'
      | 'refreshing'
      | 'unknown'
    disabled: boolean | null
    unavailable: boolean | null
    retryAt: string | null
    observedAt: string | null
    executionCounts?: {
      success: number | null
      failed: number | null
      scope: 'source_runtime'
      since: null
    } | null
  }[]
  usage: {
    scope: string
    coverageStart: string | null
    days: {
      day: string
      input: number
      output: number
      reasoning: number
      cached: number
      total: number
      requests: number
      failed: number
    }[]
  } | null
  quota: {
    accounts: {
      id: string
      windows: {
        id: string
        label: string
        remainingPercent: Decimal | null
        resetAt: string | null
        observedAt?: string | null
        basis?: 'passive_headers' | 'reviewed_plugin'
        status?: 'ok' | 'stale'
      }[]
    }[]
  } | null
  estimatedCost: { currency: string; amount: Decimal; basis: string } | null
  capabilities: {
    accounts?: SourceCapability
    executionCounts?: SourceCapability
    usage: SourceCapability
    quota: SourceCapability
    estimatedCost: SourceCapability
  }
}
export type ScheduleConfig = import('../schedule/types.ts').ScheduleInput
export interface ActivityData {
  schedule: ScheduleConfig
  resolved?: {
    phase: string
    label: string
    caption: string
    targetAt: string | null
    progressPercent: number
    restDay: boolean
  }
  presence?: unknown
  music?: unknown
  gaming?: unknown
  capabilities: { presence: SourceCapability; music: SourceCapability; gaming: SourceCapability }
}
export interface Quote {
  market: string
  symbol: string
  provider: string | null
  currency: string | null
  name: string
  price: Decimal | null
  previousClose: Decimal | null
  change: Decimal | null
  changePercent: Decimal | null
  amplitudePercent: Decimal | null
  volume: Decimal | null
  volumeUnit: string | null
  asOf: string | null
  delayedMinutes: number | null
  history: { at: string; close: Decimal }[]
  capabilities: Record<string, SourceCapability>
}
export interface QuotesData {
  items: Quote[]
}
export interface LinkItem {
  id: string
  title: string
  url: string
  icon: string
  sortOrder: number
}
export interface LinksData {
  items: LinkItem[]
}
export interface Monitor {
  id: string
  name: string
  state: 'up' | 'down' | 'maintenance' | 'pending' | 'unknown'
  latencyMs: number | null
  checkedAt: string | null
  statusPageUrl: string | null
  uptimePercent: Decimal | null
  capabilities: Record<string, SourceCapability>
}
export interface ServicesData {
  monitors: Monitor[]
}
export interface ModuleData {
  deepseek: DeepSeekData
  devices: DevicesData
  tailscale: TailscaleData
  codex: CodexData
  activity: ActivityData
  quotes: QuotesData
  links: LinksData
  services: ServicesData
}
export type DashboardSnapshots = { [K in ModuleId]: DataSnapshot<ModuleData[K]> }
