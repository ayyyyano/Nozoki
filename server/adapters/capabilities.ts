import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { cap } from './common.ts'
const known = {
  deepseek: { balance: true, spend: false },
  'deepseek-spend': { spend: false },
  sleepy: { metadata: true, devices: true, battery: false, heartbeat: false },
  'cliproxy-bridge': {
    accounts: true,
    executionCounts: true,
    telemetryPublishing: true,
    usage: false,
    quota: false,
    estimatedCost: false,
  },
  'uptime-kuma': { monitors: true, status: true, latency: true, uptime: true, history: false },
  uptimeflare: { status: true, latency: true, history: false },
  'quotes-custom': { quote: true },
}
export function declaredCapabilities(provider: IntegrationSettings['provider']) {
  return Object.fromEntries(
    Object.entries(known[provider]).map(([name, supported]) => [name, cap(supported)]),
  )
}
