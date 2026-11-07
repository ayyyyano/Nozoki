// Offline presentation fixtures; never persisted to D1.
import { createFixture } from './dashboard.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { normalizeSchedule } from '../../shared/schedule/index.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { AdminDashboardSchema } from '../../shared/contracts/public-dashboard.ts'

export const fixed = new Date('2026-11-03T03:00:00.000Z')
const canonicalDates = (v) =>
  JSON.parse(
    JSON.stringify(v, (_key, value) =>
      typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)
        ? new Date(value).toISOString()
        : value,
    ),
  )

export async function fixture(options = {}) {
  const config = createDefaultConfig()
  const data = canonicalDates(createFixture(options.empty ? 'unconfigured' : 'complete'))
  config.site.siteName = '离线布局夹具'
  config.site.background.layout = 'page'
  if (options.background) Object.assign(config.site.background, options.background)
  const order = options.order ?? config.modules.map((m) => m.id)
  for (const module of config.modules) {
    module.sortOrder = order.indexOf(module.id)
    module.enabled = options.only
      ? options.only.includes(module.id)
      : !(options.disabled ?? ['tailscale']).includes(module.id)
    if (!options.guest) module.visibility = 'public'
    if (options.loginOnly) module.visibility = 'admin'
    if (options.customTitles)
      module.title = '自定义展示名称与很长的说明文字 '.repeat(3) + module.sortOrder
    module.sources = { main: { sourceId: 'tencent', subject: 'default' } }
  }
  config.modules.find((m) => m.id === 'tailscale').ipVisibility = 'admin'
  const quotes = data.quotes.data.items
  data.quotes.data.items = Array.from({ length: options.quotes ?? 2 }, (_, i) => ({
    ...quotes[i % 2],
    symbol: ['QQQM', 'VOO', 'AAPL', 'MSFT'][i],
    provider: 'tencent',
    name: options.longNames ? '离线夹具的很长基金名称 '.repeat(12) : quotes[i % 2].name,
    asOf: i % 2 ? '2026-11-02T18:00:00.000Z' : '2026-11-02T17:00:00.000Z',
  }))
  config.quotes = data.quotes.data.items.map((q, sortOrder) => ({
    market: q.market,
    symbol: q.symbol,
    displayName: q.name,
    provider: 'tencent',
    sortOrder,
    enabled: true,
    refreshInterval: 300,
  }))
  if (options.stale) data.quotes.status = 'stale'
  if (options.devices) {
    const sample = data.devices.data.devices
    data.devices.data.devices = Array.from({ length: options.devices }, (_, i) => ({
      ...sample[i % sample.length],
      id: 'fixture-device-' + i,
      name: `夹具设备 ${i + 1}`,
      stateText: '离线夹具前台应用',
    }))
  }
  if (options.monitors) {
    const sample = data.services.data.monitors
    data.services.data.monitors = Array.from({ length: options.monitors }, (_, i) => ({
      ...sample[i % sample.length],
      id: 'fixture-monitor-' + i,
      name: `离线监控 ${i + 1} ` + (options.longNames ? '较长监控名称 '.repeat(3) : ''),
    }))
  }
  if (options.links)
    config.links = Array.from({ length: options.links }, (_, i) => ({
      ...config.links[i % 4],
      id: 'fixture-link-' + i,
      sortOrder: i,
      title: i > 3 ? '离线夹具长链接名称 '.repeat(4) : config.links[i].title,
    }))
  if (options.longActivity) {
    const schedule = normalizeSchedule(config.site.schedule)
    const slots = Array.from({ length: 12 }, (_, i) => ({
      id: 'fixture-period-' + i,
      name: '较长的离线夹具学习安排 ' + (i + 1),
      category: 'active',
      start: String(8 + i).padStart(2, '0') + ':00',
      end: String(8 + i).padStart(2, '0') + ':45',
      startDayOffset: 0,
      endDayOffset: 0,
    }))
    for (const day of Object.keys(schedule.weekdays))
      schedule.weekdays[day] = { kind: 'slots', slots }
    schedule.override = { text: '离线夹具的长计划状态 '.repeat(12) }
    config.site.schedule = schedule
  }
  const snapshots = config.modules.map((m) => ({
    source_id: 'tencent',
    subject: 'default',
    module_id: m.id,
    snapshot_json: JSON.stringify({ ...data[m.id], sourceId: 'tencent' }),
  }))
  const projected = await projectGuestDashboard({ config, integrations: [], snapshots }, fixed)
  if (options.guest) return projected
  return AdminDashboardSchema.parse({ ...projected, viewer: 'admin', configVersion: 1 })
}
