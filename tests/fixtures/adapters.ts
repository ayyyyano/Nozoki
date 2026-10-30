// Offline protocol fixtures, derived from the official examples recorded in phase-05.md.
// Synthetic values; never seeded into daily D1 or imported by production code.
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { ADAPTER_PROTOCOLS } from '../../shared/contracts/adapter.ts'
export const now = new Date('2026-10-27T06:00:00.000Z')
export const seconds = now.getTime() / 1000
export function source(provider: IntegrationSettings['provider']): IntegrationSettings {
  return {
    id: 'fixture',
    provider,
    protocolVersion: ADAPTER_PROTOCOLS[provider][0] ?? 'unselected',
    baseUrl: 'https://example.invalid/service/',
    enabled: true,
    refreshInterval: 60,
    fieldMappings: provider === 'uptime-kuma' ? { status_page_slug: 'public' } : {},
    capabilities: {},
    credentialState: { configured: false, keyVersion: null, lastUpdatedAt: null },
  }
}
export const balance = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '110.000000000000000001',
      granted_balance: '10.00',
      topped_up_balance: '100.000000000000000001',
    },
    { currency: 'USD', total_balance: '0.00', granted_balance: '0', topped_up_balance: '0' },
  ],
}
export const sleepMeta = {
  success: true,
  version: [5, 0, 0],
  version_str: '5.0-dev-20250629',
  timezone: 'Asia/Shanghai',
}
export const sleepStatus = {
  success: true,
  time: seconds,
  last_updated: seconds - 86400,
  status: { id: 0, name: '工作', desc: '状态文字不是心跳' },
  device: {
    'phone.a/~': {
      show_name: 'Synthetic device',
      status: 'Text',
      using: false,
      fields: { online: 'false', battery: '0', charging: 'true' },
      last_updated: seconds - 86400,
    },
    unknown: { show_name: 'Unknown', using: null, fields: {}, last_updated: seconds },
  },
}
export const kumaMeta = {
  config: { slug: 'public', published: true },
  publicGroupList: [
    {
      monitorList: [
        { id: 1, name: 'Synthetic web' },
        { id: 2, name: 'Pending' },
      ],
    },
  ],
}
export const kumaHearts = {
  heartbeatList: { '1': [{ status: 1, time: '2026-10-27 05:59:30.000', ping: 0 }] },
  uptimeList: { '1_24': 0.9998 },
}
export const flare = {
  up: 1,
  down: 1,
  updatedAt: seconds,
  monitors: {
    web: { up: true, latency: 0, location: 'SIN', message: 'OK' },
    api: { up: false, latency: null, location: null, message: '<script>untrusted text</script>' },
  },
}
export function replies(provider: IntegrationSettings['provider']): Record<string, unknown> {
  return provider === 'deepseek'
    ? { 'user/balance': structuredClone(balance) }
    : provider === 'sleepy'
      ? { 'api/meta': structuredClone(sleepMeta), 'api/status/query': structuredClone(sleepStatus) }
      : provider === 'uptime-kuma'
        ? {
            'api/status-page/public': structuredClone(kumaMeta),
            'api/status-page/heartbeat/public': structuredClone(kumaHearts),
          }
        : provider === 'uptimeflare'
          ? { 'api/data': structuredClone(flare) }
          : { 'v8/management/config/observability/usage/usage-statistics-enabled': true }
}
