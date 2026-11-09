import type { DashboardSnapshots, DataSnapshot, ModuleConfig } from '../contracts/dashboard.ts'
import type { LegacySchedule } from '../schedule/types.ts'
import { canonicalModules, MODULE_DISPLAY_ORDER } from './module-layout.ts'

export const DEFAULT_SCHEDULE: LegacySchedule = {
  timezone: 'Asia/Shanghai',
  start: '08:30',
  end: '17:00',
  lunchStart: '11:30',
  lunchEnd: '13:30',
  restMode: 'double',
  calendarVersion: null,
}
export function snapshot<T>(
  status: DataSnapshot<T>['status'],
  data: T | null = null,
  sourceId = 'not-configured',
): DataSnapshot<T> {
  return {
    status,
    data,
    sourceId,
    observedAt: null,
    collectedAt: null,
    lastSuccessAt: null,
    expiresAt: null,
  }
}
export const unavailableCapability = () => ({ supported: false, verified: false })
export function createUnconfiguredDashboard(): DashboardSnapshots {
  return {
    deepseek: snapshot('unconfigured'),
    devices: snapshot('unconfigured'),
    tailscale: snapshot('unconfigured'),
    codex: snapshot('unconfigured'),
    activity: snapshot(
      'ok',
      {
        schedule: structuredClone(DEFAULT_SCHEDULE),
        capabilities: {
          presence: unavailableCapability(),
          music: unavailableCapability(),
          gaming: unavailableCapability(),
        },
      },
      'local-default-schedule',
    ),
    quotes: snapshot('unconfigured', {
      items: ['QQQM', 'VOO'].map((symbol) => ({
        market: 'US',
        symbol,
        provider: null,
        currency: 'USD',
        name: symbol === 'QQQM' ? '纳斯达克 100 ETF' : '标普 500 ETF',
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
        capabilities: {},
      })),
    }),
    links: snapshot(
      'ok',
      {
        items: [
          { id: 'blog', title: '博客', url: 'https://blog.nekro.top/', icon: 'book', sortOrder: 0 },
          {
            id: 'projects',
            title: '项目',
            url: 'https://github.com/ayyyyano',
            icon: 'code',
            sortOrder: 1,
          },
          {
            id: 'home',
            title: '主页',
            url: 'https://www.nekro.top/',
            icon: 'home',
            sortOrder: 2,
          },
          {
            id: 'about',
            title: '关于',
            url: 'https://blog.nekro.top/about/',
            icon: 'person',
            sortOrder: 3,
          },
        ],
      },
      'static-links',
    ),
    services: snapshot('unconfigured'),
  }
}
export function defaultModules(): ModuleConfig[] {
  return MODULE_DISPLAY_ORDER.map((id, i) => ({
    id,
    title: {
      deepseek: 'DeepSeek',
      devices: '设备',
      tailscale: 'Tailscale',
      codex: 'Codex',
      activity: '在干嘛',
      quotes: '自选行情',
      links: '常用链接',
      services: '服务状态',
    }[id],
    enabled: id !== 'tailscale',
    ...(id === 'tailscale' ? { ipVisibility: 'admin' as const } : {}),
    ...(id === 'deepseek' ? { guestBlur: false } : {}),
    sortOrder: i,
    visibility: ['activity', 'quotes', 'links'].includes(id) ? 'public' : 'admin',
    guestBehavior: 'login_hint',
    fields: {},
  }))
}
/** Layout only: production role/field authorization must be implemented server-side in phase 03. */
export function layoutModules(modules: ModuleConfig[]): ModuleConfig[] {
  return canonicalModules(modules).filter((m) => m.enabled)
}
export function isSafeLink(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
