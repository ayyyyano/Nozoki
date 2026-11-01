import type { IntegrationSettings } from '../contracts/config.ts'

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
    credentialState: { configured: false, keyVersion: null, lastUpdatedAt: null },
  }
}
