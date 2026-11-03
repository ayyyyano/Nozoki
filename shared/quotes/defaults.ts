import type { IntegrationSettings } from '../contracts/config.ts'

export const TENCENT_SERVICE = {
  provider: 'quotes-custom',
  protocolVersion: 'tencent-us-v1',
  baseUrl: 'https://web.ifzq.gtimg.cn/',
  authentication: 'none',
} as const

export function createTencentSource(id = 'tencent'): IntegrationSettings {
  return {
    ...createYahooSource(id),
    protocolVersion: TENCENT_SERVICE.protocolVersion,
    baseUrl: TENCENT_SERVICE.baseUrl,
  }
}

export const YAHOO_SERVICE = {
  provider: 'quotes-custom',
  protocolVersion: 'yahoo-chart-v8',
  baseUrl: 'https://query1.finance.yahoo.com/',
  authentication: 'none',
} as const

/** Mirror endpoint; equally approved so deployments can switch when one host is rate-limited. */
export const YAHOO_SERVICE_MIRROR = {
  ...YAHOO_SERVICE,
  baseUrl: 'https://query2.finance.yahoo.com/',
} as const

export function createYahooSource(id = 'yahoo'): IntegrationSettings {
  return {
    id,
    provider: YAHOO_SERVICE.provider,
    protocolVersion: YAHOO_SERVICE.protocolVersion,
    baseUrl: YAHOO_SERVICE.baseUrl,
    enabled: true,
    refreshInterval: 300,
    fieldMappings: {},
    capabilities: { quote: { supported: true, verified: false } },
    access: { mode: 'legacy' },
    credentialState: { configured: false, keyVersion: null, lastUpdatedAt: null },
  }
}
