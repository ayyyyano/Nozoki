import type { IntegrationSettings } from '../contracts/config.ts'

export const YAHOO_SERVICE = {
  provider: 'quotes-custom',
  protocolVersion: 'yahoo-chart-v8',
  baseUrl: 'https://query1.finance.yahoo.com/',
  authentication: 'none',
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
