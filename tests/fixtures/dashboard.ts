import type { DashboardSnapshots, DataStatus, ModuleId } from '../../shared/contracts/dashboard.ts'
import {
  createUnconfiguredDashboard,
  unavailableCapability,
} from '../../shared/domain/dashboard.ts'

export const FIXTURE_MARKER = 'NOZOKI_FIXTURE_ONLY_20261025'
export const SCENARIOS = [
  'unconfigured',
  'complete',
  'edge',
  'empty',
  'error',
  'stale',
  'unsupported',
  'offline',
] as const
export type Scenario = (typeof SCENARIOS)[number]
const at = '2026-10-23T07:25:00.000Z'
const capability = () => ({
  supported: true,
  verified: false,
  reason: '演示夹具，不代表实例已验证',
})
export function createFixture(scenario: Scenario): DashboardSnapshots {
  const data = createUnconfiguredDashboard()
  if (scenario === 'unconfigured') return data
  const edge = scenario === 'edge'
  data.deepseek.data = {
    balances: [
      {
        currency: 'CNY',
        total: edge ? '1234567890123456.123456' : '126.50',
        toppedUp: '100.00',
        granted: '26.50',
      },
      { currency: 'USD', total: '0.00', toppedUp: '0.00', granted: '0.00' },
    ],
    spend: Array.from({ length: 8 }, (_, i) => ({
      day: `2026-10-${16 + i}`,
      currency: 'CNY',
      amount: String([2, 5, 1, 4, 3, 7, 2, 4][i]),
      sourceId: FIXTURE_MARKER,
    })),
    capabilities: { balance: capability(), spend: capability() },
  }
  data.devices.data = {
    devices: [
      {
        id: 'phone',
        name: edge ? '一台名称很长的随身设备 · 不应该挤出卡片边缘的 iPhone' : 'iPhone 17 Pro',
        using: true,
        stateText: '正在使用',
        online: true,
        batteryPercent: edge ? 0 : 78,
        charging: false,
        observedAt: at,
        heartbeatAt: null,
        capabilities: { battery: capability() },
      },
      {
        id: 'tablet',
        name: 'iPad Pro 11-inch',
        using: false,
        stateText: null,
        online: null,
        batteryPercent: 42,
        charging: true,
        observedAt: at,
        heartbeatAt: null,
        capabilities: { battery: capability() },
      },
      {
        id: 'watch',
        name: 'Apple Watch',
        using: null,
        stateText: '电量能力未支持',
        online: null,
        batteryPercent: null,
        charging: null,
        observedAt: at,
        heartbeatAt: null,
        capabilities: { battery: unavailableCapability() },
      },
    ],
  }
  data.codex.data = {
    usage: {
      scope: '仅经 CLIProxyAPI 的演示流量',
      coverageStart: at,
      days: [
        {
          day: '2026-10-23',
          input: 84000,
          output: 12500,
          reasoning: 2500,
          cached: 26000,
          total: 96500,
          requests: 42,
          failed: 1,
        },
      ],
    },
    quota: {
      accounts: [
        {
          id: 'demo',
          windows: [
            {
              id: '5h',
              label: '5 小时窗口 · 剩余',
              remainingPercent: edge ? '0' : '68',
              resetAt: at,
            },
          ],
        },
      ],
    },
    estimatedCost: null,
    capabilities: {
      usage: capability(),
      quota: capability(),
      estimatedCost: unavailableCapability(),
    },
  }
  for (const [i, quote] of (data.quotes.data?.items ?? []).entries()) {
    Object.assign(quote, {
      provider: FIXTURE_MARKER,
      price: i ? '562.34' : '223.45',
      previousClose: i ? '564.00' : '221.00',
      change: i ? '-1.66' : '2.45',
      changePercent: i ? '-0.29' : '1.11',
      amplitudePercent: '1.25',
      volume: '120000',
      volumeUnit: '股',
      asOf: at,
      delayedMinutes: 15,
      history: Array.from({ length: 8 }, (_, n) => ({
        at: `2026-10-${16 + n}T07:25:00Z`,
        close: String(200 + n + [0, 2, 1, 3, 0, 2, 1, 0][n]!),
      })),
      capabilities: { history: capability() },
    })
  }
  if (edge && data.links.data) data.links.data.items[0]!.title = '一个很长的博客与日常记录链接名称'
  data.services.data = {
    monitors: [
      {
        id: 'web',
        name: '示例站点',
        state: 'up',
        latencyMs: 128,
        checkedAt: at,
        statusPageUrl: null,
        uptimePercent: null,
        capabilities: {},
      },
      {
        id: 'api',
        name: edge ? '一个名称非常长的示例 API 监控对象' : '示例 API',
        state: 'down',
        latencyMs: null,
        checkedAt: at,
        statusPageUrl: null,
        uptimePercent: null,
        capabilities: {},
      },
      {
        id: 'storage',
        name: '示例存储',
        state: 'maintenance',
        latencyMs: null,
        checkedAt: at,
        statusPageUrl: null,
        uptimePercent: null,
        capabilities: {},
      },
    ],
  }
  if (edge) {
    data.devices.data.devices.push(
      ...Array.from({ length: 3 }, (_, index) => ({
        ...data.devices.data!.devices[1]!,
        id: `extra-${index}`,
        name: `扩展设备 ${index + 1} · 多设备布局演示`,
        batteryPercent: index * 25,
      })),
    )
    data.services.data.monitors.push(
      ...Array.from({ length: 3 }, (_, index) => ({
        ...data.services.data!.monitors[0]!,
        id: `extra-${index}`,
        name: `扩展服务 ${index + 1}`,
        state: 'pending' as const,
      })),
    )
  }
  for (const id of Object.keys(data) as ModuleId[]) {
    // Local configuration links do not inherit upstream telemetry/collection failures.
    if (id === 'links') continue
    const status: DataStatus = ['error', 'stale', 'unsupported', 'offline'].includes(scenario)
      ? (scenario as DataStatus)
      : 'ok'
    Object.assign(data[id], {
      status,
      sourceId: FIXTURE_MARKER,
      observedAt: at,
      collectedAt: at,
      lastSuccessAt: status === 'error' ? null : at,
      expiresAt: '2026-10-23T07:26:00.000Z',
    })
    if (scenario === 'error' || scenario === 'unsupported' || scenario === 'offline')
      data[id].data = null
  }
  if (scenario === 'empty') {
    data.activity.data = null
    data.deepseek.data!.balances = []
    data.deepseek.data!.spend = []
    data.devices.data!.devices = []
    data.codex.data!.usage!.days = []
    data.codex.data!.quota!.accounts = []
    data.quotes.data!.items = []
    data.services.data!.monitors = []
  }
  return data
}
