import type { DashboardSnapshots, ModuleId } from '../contracts/dashboard.ts'
import type { PublicDashboard, AdminDashboard } from '../contracts/public-dashboard.ts'
import { snapshot, unavailableCapability } from './dashboard.ts'
import { monitorCode, monitorLatency, monitorName } from './home-summary.ts'
/** UI nulls mean withheld/unknown. Never reconstruct private values or zero financial metrics. */
export function dashboardView(dto: PublicDashboard | AdminDashboard): DashboardSnapshots {
  const result = Object.fromEntries(
    ['deepseek', 'devices', 'tailscale', 'codex', 'activity', 'quotes', 'links', 'services'].map(
      (id) => [id, snapshot('unconfigured')],
    ),
  ) as DashboardSnapshots
  for (const m of dto.modules) {
    if (m.kind !== 'data') continue
    const raw = m.snapshot.data as Record<string, any> | null
    let data: any = null
    if (raw) {
      if (m.id === 'deepseek')
        data = {
          balances: (raw.balances ?? []).map((v: any) => ({
            currency: '',
            total: null,
            toppedUp: null,
            granted: null,
            ...v,
          })),
          dailyBalances: raw.dailyBalances ?? [],
          timezone: raw.timezone,
          masked: raw.masked === true,
          capabilities: { balance: unavailableCapability() },
        }
      if (m.id === 'devices')
        data = {
          devices: (raw.devices ?? []).map((v: any, i: number) => ({
            id: `visible-${i}`,
            using: null,
            stateText: null,
            foregroundApp: null,
            online: null,
            batteryPercent: null,
            charging: null,
            observedAt: null,
            heartbeatAt: null,
            statusUpdatedAt: null,
            ...v,
            name: typeof v.name === 'string' && v.name.trim() ? v.name : '设备',
            capabilities: {},
          })),
        }
      if (m.id === 'tailscale')
        data = {
          devices: (raw.devices ?? []).map((v: any, i: number) => ({
            id: `visible-${i}`,
            connectedToControl: null,
            lastSeen: null,
            ...v,
            name: typeof v.name === 'string' && v.name.trim() ? v.name : '节点',
            addresses: v.addresses ?? [],
            addressesHidden: v.addressesHidden === true,
          })),
        }
      if (m.id === 'codex')
        data = {
          ...raw,
          usage: raw.usage
            ? { scope: '范围未公开', coverageStart: null, ...raw.usage, days: raw.usage.days ?? [] }
            : null,
          accounts: (raw.accounts ?? []).map((a: any, i: number) => ({
            id: `visible-${i}`,
            provider: 'codex',
            state: 'unknown',
            disabled: null,
            unavailable: null,
            retryAt: null,
            observedAt: null,
            ...a,
          })),
          quota: raw.quota
            ? {
                accounts: (raw.quota.accounts ?? []).map((a: any, i: number) => ({
                  id: a.id ?? `visible-${i}`,
                  windows: (a.windows ?? []).map((w: any, j: number) => ({
                    id: `window-${j}`,
                    label: '窗口',
                    remainingPercent: null,
                    resetAt: null,
                    ...w,
                  })),
                })),
              }
            : null,
          estimatedCost: raw.estimatedCost ?? null,
          capabilities: {
            usage: unavailableCapability(),
            quota: unavailableCapability(),
            estimatedCost: unavailableCapability(),
          },
        }
      if (m.id === 'activity')
        data = raw.schedule
          ? {
              ...raw,
              capabilities: {
                presence: unavailableCapability(),
                music: unavailableCapability(),
                gaming: unavailableCapability(),
              },
            }
          : null
      if (m.id === 'quotes')
        data = {
          items: (raw.items ?? []).map((v: any) => ({
            market: '',
            symbol: '未公开',
            name: '',
            provider: null,
            currency: null,
            price: null,
            previousClose: null,
            change: null,
            changePercent: null,
            amplitudePercent: null,
            volume: null,
            volumeUnit: null,
            asOf: null,
            delayedMinutes: null,
            history: [],
            ...v,
            capabilities: {},
          })),
        }
      if (m.id === 'links')
        data = {
          items: (raw.items ?? [])
            .filter((v: any) => typeof v.url === 'string')
            .map((v: any, i: number) => ({
              id: `visible-${i}`,
              title: '链接',
              icon: 'link',
              sortOrder: i,
              ...v,
            })),
        }
      if (m.id === 'services')
        data = {
          monitors: (raw.monitors ?? []).map((v: any, i: number) => ({
            id: `visible-${i}`,
            state: 'unknown',
            checkedAt: null,
            statusPageUrl: null,
            uptimePercent: null,
            ...v,
            name: monitorName(v.name, typeof v.id === 'string' ? monitorCode(v.id) : '服务'),
            latencyMs: monitorLatency(v.latencyMs),
            displayId: typeof v.id === 'string' ? monitorCode(v.id) : null,
            capabilities: {},
          })),
        }
    }
    Object.assign(result, { [m.id]: { ...m.snapshot, data, sourceId: 'projected' } })
  }
  return result
}
