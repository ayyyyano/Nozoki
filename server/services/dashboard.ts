import type { Config, ModuleSettings } from '../../shared/contracts/config.ts'
import type { ModuleId } from '../../shared/contracts/dashboard.ts'
import { snapshotSchema, DataSchemas } from '../../shared/contracts/snapshots.ts'
import {
  PublicDashboardSchema,
  AdminDashboardSchema,
  type PublicDashboard,
  type AdminDashboard,
} from '../../shared/contracts/public-dashboard.ts'
import { createUnconfiguredDashboard, snapshot } from '../../shared/domain/dashboard.ts'
import { readStoredState, type StoredState } from '../repositories/config.ts'
import type { Database } from '../types/database.ts'
import { isIntegrationConfigured } from './credentials.ts'
import { parseFieldPath, pathPrefix } from '../../shared/contracts/field-paths.ts'
import { ModuleSettingsSchema } from '../../shared/contracts/config.ts'
import { DataLayerError } from '../types/database.ts'
import { withCollectionState } from './collection-dashboard.ts'
type Json = null | string | number | boolean | Json[] | { [key: string]: Json }
export interface GuestModule {
  id: ModuleId
  title: string
  sortOrder: number
  kind: 'data' | 'login_required'
  snapshot?: Record<string, Json>
}
/** Rules match every prefix; a public child never reverses an ancestor's restriction. */
function fieldRules(module: ModuleSettings) {
  return Object.entries(module.fields).map(([rule, policy]) => {
    const parts = parseFieldPath(module.id, rule)
    if (!parts) throw new DataLayerError('CONFIG_BASELINE_INVALID')
    return { parts, policy }
  })
}
function allowed(
  module: ModuleSettings,
  path: string[],
  admin = false,
  rules = fieldRules(module),
) {
  return rules.every(({ parts, policy }) => {
    const matches = pathPrefix(parts, path)
    return !matches || (policy.enabled && (admin || policy.visibility === 'public'))
  })
}
function group(module: ModuleSettings, path: string[]): string | undefined {
  const field = path.at(-1)
  if (module.id === 'deepseek') {
    if (path[0] === 'balances')
      return ['toppedUp', 'granted'].includes(field ?? '') ? 'balanceBreakdown' : 'balance'
    if (path[0] === 'spend') return 'spend'
  }
  if (module.id === 'devices') {
    if (['batteryPercent', 'charging'].includes(field ?? '')) return 'battery'
    if (['using', 'online', 'heartbeatAt'].includes(field ?? '')) return 'usage'
    if (field === 'stateText' || field === 'foregroundApp') return 'stateText'
  }
  if (module.id === 'activity' && ['schedule', 'resolved'].includes(path[0] ?? ''))
    return 'schedule'
  if (module.id === 'quotes' && path[0] === 'items')
    return path.includes('history') ? 'history' : 'quote'
  if (module.id === 'services' && path[0] === 'monitors')
    return field === 'latencyMs' ? 'latency' : field === 'uptimePercent' ? 'history' : 'status'
  return undefined
}
function projectValue(
  value: Json,
  module: ModuleSettings,
  path: string[] = [],
  admin = false,
  rules = fieldRules(module),
): Json | undefined {
  if (!allowed(module, path, admin, rules)) return undefined
  if (
    module.id === 'tailscale' &&
    path.includes('addresses') &&
    (module.ipVisibility === 'hidden' || (module.ipVisibility !== 'public' && !admin))
  )
    return undefined
  const g = group(module, path)
  if (g && !allowed(module, [g], admin, rules)) return undefined
  // A window title may exist in either alias, including old snapshots. Apply the stricter
  // policy to both, so a hidden application cannot reappear through fallback text/tooltips.
  if (module.id === 'devices' && ['stateText', 'foregroundApp'].includes(path.at(-1) ?? '')) {
    const parent = path.slice(0, -1)
    if (
      !allowed(module, [...parent, 'stateText'], admin, rules) ||
      !allowed(module, [...parent, 'foregroundApp'], admin, rules)
    )
      return undefined
  }
  if (Array.isArray(value))
    return value.flatMap((v) => {
      const id =
        v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string'
          ? `@${v.id}`
          : '*'
      const result = projectValue(v, module, [...path, id], admin, rules)
      return result === undefined ? [] : [result]
    })
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Json> = {}
    for (const [key, v] of Object.entries(value)) {
      // Internal source IDs and unverified upstream explanations never cross this boundary.
      if (['sourceId', 'capabilities', 'reason'].includes(key)) continue
      const next = projectValue(v, module, [...path, key], admin, rules)
      if (next !== undefined) out[key] = next
    }
    if (module.id === 'tailscale' && path[0] === 'devices' && path.length === 2) {
      out.addressesHidden = !Array.isArray(out.addresses)
      // A hostname can itself contain an IP. Do not leak a hidden address via its tooltip.
      if (out.addressesHidden && typeof out.name === 'string' && Array.isArray(value.addresses))
        for (const address of value.addresses)
          if (typeof address === 'string') out.name = out.name.replaceAll(address, '****')
    }
    return out
  }
  return value
}
function rawSnapshot(state: StoredState, m: ModuleSettings, admin = false) {
  if (m.id === 'activity')
    return snapshot(
      'ok',
      {
        schedule: state.config.site.schedule,
        capabilities: {
          presence: { supported: false, verified: false },
          music: { supported: false, verified: false },
          gaming: { supported: false, verified: false },
        },
      },
      'local-schedule',
    )
  if (m.id === 'links')
    return snapshot(
      'ok',
      {
        items: state.config.links
          .filter((l) => l.enabled && (admin || l.visibility === 'public'))
          .map(({ enabled: _enabled, visibility: _visibility, ...l }) => l),
      },
      'local-links',
    )
  const source = m.sources.main
  if (source) {
    const integration = state.config.integrations.find(
      (i) => i.id === source.sourceId && isIntegrationConfigured(i),
    )
    const row =
      integration &&
      state.snapshots.find(
        (s) =>
          s.source_id === source.sourceId && s.subject === source.subject && s.module_id === m.id,
      )
    if (row) {
      try {
        if (typeof row.snapshot_json !== 'string' || row.snapshot_json.length > 500000)
          return snapshot('error')
        const parsed = snapshotSchema(m.id).safeParse(JSON.parse(row.snapshot_json))
        if (parsed.success && parsed.data.sourceId === source.sourceId) {
          if (m.id === 'quotes' && parsed.data.data) {
            const quotes = DataSchemas.quotes.parse(parsed.data.data)
            const identity = (q: { market: string; symbol: string; provider: string | null }) =>
              JSON.stringify([q.market, q.symbol, q.provider])
            const byId = new Map(quotes.items.map((q) => [identity(q), q]))
            return {
              ...parsed.data,
              data: {
                items: state.config.quotes
                  .filter((q) => q.enabled && q.provider === source.sourceId)
                  .flatMap((q) => {
                    const item = byId.get(identity(q))
                    return item ? [item] : []
                  }),
              },
            }
          }
          return parsed.data
        }
      } catch {
        /* Do not expose corrupt stored JSON or its source address. */
      }
      return snapshot('error')
    }
  }
  if (m.id === 'quotes') {
    const blank = createUnconfiguredDashboard().quotes.data!.items[0]!
    return snapshot('unconfigured', {
      items: state.config.quotes
        .filter((q) => q.enabled)
        .map((q) => ({
          ...blank,
          market: q.market,
          symbol: q.symbol,
          name: q.displayName,
          provider: q.provider,
          currency: null,
          history: [],
        })),
    })
  }
  return snapshot('unconfigured')
}
async function publicVersion(config: Config, modules: GuestModule[]) {
  // Ignore snapshots, generation times and private/global versions: private edits cannot bump this hash.
  const visible = modules.map((m) =>
    m.kind === 'login_required'
      ? m
      : {
          id: m.id,
          title: m.title,
          sortOrder: m.sortOrder,
          kind: m.kind,
          publicShape: publicShape(m.snapshot?.data ?? null),
          defaults:
            m.id === 'links'
              ? projectValue(
                  {
                    items: config.links
                      .filter((l) => l.enabled && l.visibility === 'public')
                      .map(({ visibility: _v, enabled: _e, ...l }) => l),
                  },
                  config.modules.find((c) => c.id === m.id)!,
                )
              : m.id === 'quotes'
                ? projectValue(
                    {
                      items: config.quotes
                        .filter((q) => q.enabled)
                        .map((q) => ({
                          market: q.market,
                          symbol: q.symbol,
                          name: q.displayName,
                          provider: q.provider,
                        })),
                    },
                    config.modules.find((c) => c.id === m.id)!,
                  )
                : m.id === 'activity'
                  ? projectValue(
                      config.site.schedule as unknown as Json,
                      config.modules.find((c) => c.id === 'activity')!,
                      ['schedule'],
                    )
                  : null,
        },
  )
  const data = JSON.stringify({
    siteName: config.site.siteName,
    timezone: config.site.timezone,
    appearance: config.site.appearance,
    background: publicBackground(config),
    modules: visible,
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return `public-v1-${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('')}`
}
// Include only exposed field structure and exposed stable IDs, never telemetry values or hidden IDs.
function publicShape(value: Json): Json {
  if (Array.isArray(value)) return value.map(publicShape)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        key === 'id' && typeof v === 'string' ? v : publicShape(v),
      ]),
    )
  return null
}
function publicBackground(config: Config) {
  return {
    ...config.site.background,
    url: config.site.background.source === 'custom' ? config.site.background.url : '',
  }
}
async function projectDashboard(state: StoredState, now = new Date(), admin = false) {
  const modules: GuestModule[] = []
  for (const m of state.config.modules.toSorted(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  )) {
    if (!ModuleSettingsSchema.safeParse(m).success)
      throw new DataLayerError('CONFIG_BASELINE_INVALID')
    if (!m.enabled) continue
    if (!admin && m.visibility !== 'public') {
      if (m.guestBehavior === 'login_hint')
        modules.push({ id: m.id, title: m.title, sortOrder: m.sortOrder, kind: 'login_required' })
      continue
    }
    const raw = rawSnapshot(state, m, admin)
    const { sourceId: _sourceId, ...safe } = raw
    if (safe.expiresAt && safe.expiresAt < now.toISOString() && safe.status === 'ok')
      safe.status = 'stale'
    const projected = projectValue(safe.data as Json, m, [], admin)
    modules.push({
      id: m.id,
      title: m.title,
      sortOrder: m.sortOrder,
      kind: 'data',
      snapshot: { ...safe, data: projected ?? null } as Record<string, Json>,
    })
  }
  const services = modules.find((m) => m.id === 'services' && m.kind === 'data')?.snapshot?.data as
    { monitors?: { state?: string }[] } | null | undefined
  const summary = services?.monitors
    ? {
        services: {
          up: services.monitors.filter((m) => m.state === 'up').length,
          down: services.monitors.filter((m) => m.state === 'down').length,
        },
      }
    : {}
  return (admin ? AdminDashboardSchema : PublicDashboardSchema).parse({
    contractVersion: 1 as const,
    viewer: admin ? 'admin' : 'guest',
    generatedAt: now.toISOString(),
    configVersion: admin
      ? state.config.site.configVersion
      : await publicVersion(state.config, modules),
    site: {
      siteName: state.config.site.siteName,
      timezone: state.config.site.timezone,
      appearance: state.config.site.appearance,
      background: publicBackground(state.config),
    },
    modules,
    summary,
  })
}
export async function readGuestDashboard(db: Database, now = new Date()) {
  return projectGuestDashboard(
    await withCollectionState(db, await readStoredState(db, true), now),
    now,
  )
}
export async function projectGuestDashboard(
  state: StoredState,
  now = new Date(),
): Promise<PublicDashboard> {
  return (await projectDashboard(state, now, false)) as PublicDashboard
}
export async function readAdminDashboard(db: Database, now = new Date()) {
  return (await projectDashboard(
    await withCollectionState(db, await readStoredState(db, 'admin'), now),
    now,
    true,
  )) as AdminDashboard
}
