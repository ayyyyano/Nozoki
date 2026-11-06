import type { ConfigWrite, IntegrationSettings } from '../contracts/config.ts'
import { managedServiceRoot, sourceTargetKey } from '../contracts/source-access.ts'
import { canonical } from '../contracts/admin.ts'
import { TENCENT_SERVICE, YAHOO_SERVICE, YAHOO_SERVICE_MIRROR } from '../quotes/defaults.ts'

export type IntegrationDraft = ConfigWrite['integrations'][number]
export const SOURCE_WRITE_ERRORS = {
  SOURCE_TYPE_FIXED: '已创建的来源类型和协议不能更改，请新建对应来源。',
  SOURCE_ACCESS_REQUIRED: '请确认来源的公网 HTTPS 访问目标。',
  SOURCE_PROTOCOL_UNSUPPORTED: '此旧协议无法安全修改，请新建受支持的来源。',
  SOURCE_AUTH_MISMATCH: '认证方式与来源类型不匹配，原配置已保留。',
  SOURCE_TARGET_FIXED: '此类型使用固定服务地址。',
  SOURCE_MAPPING_FIXED: '此来源仅允许编辑已支持的配置字段。',
  SOURCE_CAPABILITIES_READONLY: '能力状态由服务验证，不能手动更改。',
  SOURCE_STATUS_PAGE_REQUIRED: '请填写有效的状态页标识。',
  SOURCE_TEST_REQUIRED: '请先测试此来源，测试通过后再保存。',
  SOURCE_TYPE_DUPLICATE: '此类型已添加，请编辑已有来源。',
  SOURCE_IN_USE: '此来源仍被模块或行情标的引用，请先解除引用。',
} as const
export type SourceWriteIssue = keyof typeof SOURCE_WRITE_ERRORS
export interface SecretField {
  key: string
  label: string
  secret: boolean
  max: number
}
export interface IntegrationPreset {
  id: string
  provider: IntegrationSettings['provider']
  protocol: string
  name: string
  icon: string
  description: string
  roots: readonly string[]
  authentication: 'none' | 'bearer' | 'tailscale-oauth'
  credentialLabel: string
  secretFields?: readonly SecretField[]
  instanceAddress: boolean
  interval: number
  builtin: boolean
  singleton: boolean
  fields: readonly { key: string; label: string; max: number }[]
  capabilities: readonly { key: string; label: string }[]
  note?: string
  identityImport?: boolean
}
const definitions: IntegrationPreset[] = [
  {
    id: 'deepseek',
    provider: 'deepseek',
    protocol: 'deepseek-balance-v1',
    name: 'DeepSeek',
    icon: 'spark',
    description: '账户余额与每日余额记录，需要 API Key。',
    roots: ['https://api.deepseek.com/'],
    authentication: 'bearer',
    credentialLabel: 'API Key',
    instanceAddress: false,
    interval: 300,
    builtin: false,
    singleton: true,
    fields: [],
    capabilities: [{ key: 'balance', label: '账户余额' }],
  },
  {
    id: 'sleepy',
    provider: 'sleepy',
    protocol: 'sleepy-v5-status',
    name: 'Sleepy',
    icon: 'devices',
    description: '设备状态与可识别的电量，需要实例 HTTPS 地址。',
    roots: [],
    authentication: 'none',
    credentialLabel: '访问令牌',
    instanceAddress: true,
    interval: 300,
    builtin: false,
    singleton: true,
    fields: [],
    capabilities: [
      { key: 'devices', label: '设备状态' },
      { key: 'battery', label: '电量识别' },
    ],
  },
  {
    id: 'tailscale',
    provider: 'tailscale',
    protocol: 'tailscale-devices-v2',
    name: 'Tailscale',
    icon: 'network',
    description: 'Tailnet 设备列表，需要只读 OAuth Client。',
    roots: ['https://api.tailscale.com/'],
    authentication: 'tailscale-oauth',
    credentialLabel: 'OAuth 凭据',
    secretFields: [
      { key: 'clientId', label: 'OAuth Client ID', secret: false, max: 4096 },
      { key: 'clientSecret', label: 'OAuth Client Secret', secret: true, max: 4096 },
    ],
    instanceAddress: false,
    interval: 300,
    builtin: false,
    singleton: true,
    fields: [],
    capabilities: [
      { key: 'devices', label: '设备列表' },
      { key: 'connection', label: '连接状态' },
    ],
    note: 'OAuth Client 仅需 devices:core:read。设备 IP 的显示方式在 Dashboard 模块中设置。',
  },
  {
    id: 'cliproxy',
    provider: 'cliproxy-bridge',
    protocol: 'cliproxy-v8-accounts',
    name: 'CLIProxyAPI',
    icon: 'code',
    description: '账户状态与来源提供的被动额度，需要实例地址和 Management Key。',
    roots: [],
    authentication: 'bearer',
    credentialLabel: 'Management Key',
    instanceAddress: true,
    interval: 300,
    builtin: false,
    singleton: true,
    fields: [],
    capabilities: [
      { key: 'accounts', label: '账户状态' },
      { key: 'quota', label: '被动额度' },
    ],
    identityImport: true,
  },
  {
    id: 'kuma',
    provider: 'uptime-kuma',
    protocol: 'kuma-public-2.0.2',
    name: 'Uptime Kuma',
    icon: 'MonitorHeartRound',
    description: '公开监控状态页，需要实例地址与状态页标识。',
    roots: [],
    authentication: 'none',
    credentialLabel: '访问令牌',
    instanceAddress: true,
    interval: 300,
    builtin: false,
    singleton: true,
    fields: [{ key: 'status_page_slug', label: '状态页标识（slug）', max: 64 }],
    capabilities: [
      { key: 'status', label: '监控状态' },
      { key: 'latency', label: '响应延迟' },
    ],
  },
  {
    id: 'uptimeflare',
    provider: 'uptimeflare',
    protocol: 'uptimeflare-data-2024',
    name: 'UptimeFlare',
    icon: 'CloudDoneRound',
    description: '监控状态与延迟，需要实例 HTTPS 地址。',
    roots: [],
    authentication: 'none',
    credentialLabel: '访问令牌',
    instanceAddress: true,
    interval: 300,
    builtin: false,
    singleton: true,
    fields: [],
    capabilities: [
      { key: 'status', label: '监控状态' },
      { key: 'latency', label: '响应延迟' },
    ],
  },
  {
    id: 'tencent',
    provider: TENCENT_SERVICE.provider,
    protocol: TENCENT_SERVICE.protocolVersion,
    name: '腾讯行情',
    icon: 'chart',
    description: '内置行情来源，无需凭据。',
    roots: [TENCENT_SERVICE.baseUrl],
    authentication: 'none',
    credentialLabel: '',
    instanceAddress: false,
    interval: 300,
    builtin: true,
    singleton: true,
    fields: [],
    capabilities: [{ key: 'quote', label: '行情报价' }],
    note: '使用现有腾讯行情接口，仅供个人看板展示；连接状态和数据时效以实际采集结果为准。',
  },
  {
    id: 'yahoo',
    provider: YAHOO_SERVICE.provider,
    protocol: YAHOO_SERVICE.protocolVersion,
    name: 'Yahoo 行情',
    icon: 'QueryStatsRound',
    description: '可选的非官方行情来源，无需凭据。',
    roots: [YAHOO_SERVICE.baseUrl, YAHOO_SERVICE_MIRROR.baseUrl],
    authentication: 'none',
    credentialLabel: '',
    instanceAddress: false,
    interval: 300,
    builtin: false,
    singleton: true,
    fields: [],
    capabilities: [{ key: 'quote', label: '行情报价' }],
    note: '非官方端点，没有公开行情使用许可；可能限制数据中心出口。默认使用腾讯行情。',
  },
]
export const INTEGRATION_PRESETS: readonly IntegrationPreset[] = definitions
export function integrationPreset(
  source: Pick<IntegrationSettings, 'provider' | 'protocolVersion'> | undefined,
) {
  if (!source) return undefined
  return INTEGRATION_PRESETS.find(
    (p) => p.provider === source.provider && p.protocol === source.protocolVersion,
  )
}
export function fixedPresetTarget(
  source: Pick<IntegrationSettings, 'provider' | 'protocolVersion' | 'baseUrl'>,
) {
  const p = integrationPreset(source)
  if (!p || !source.baseUrl) return false
  try {
    return p.roots.includes(managedServiceRoot(source.baseUrl, 'public'))
  } catch {
    return false
  }
}
export function presetAlreadyAdded(
  preset: IntegrationPreset,
  sources: readonly Pick<IntegrationSettings, 'provider' | 'protocolVersion'>[],
) {
  return preset.singleton && sources.some((source) => integrationPreset(source)?.id === preset.id)
}
/** Creates only local config data. No clock, randomness, storage, framework or network access. */
export function createIntegrationDraft(
  presetId: string,
  sources: readonly Pick<IntegrationSettings, 'id' | 'provider' | 'protocolVersion'>[],
  entropy: string,
): IntegrationDraft {
  const p = INTEGRATION_PRESETS.find((p) => p.id === presetId)
  if (!p || presetAlreadyAdded(p, sources)) throw new Error('SOURCE_PRESET_UNAVAILABLE')
  const ids = new Set(sources.map((s) => s.id))
  if (ids.has(p.id)) throw new Error('SOURCE_PRESET_UNAVAILABLE')
  const id = p.id
  const source: IntegrationDraft = {
    id,
    provider: p.provider,
    protocolVersion: p.protocol,
    baseUrl: p.roots[0] ?? null,
    enabled: p.builtin,
    refreshInterval: p.interval,
    fieldMappings: {},
    capabilities: {},
    credential: { operation: 'keep' },
    access: {
      mode: 'public',
      authentication: p.authentication,
      approved: false,
      approvedTarget: null,
    },
  }
  if (source.baseUrl && source.access?.mode === 'public') {
    source.access.approved = true
    source.access.approvedTarget = sourceTargetKey(source, source.access)
  }
  return source
}
export function credentialFields(preset: IntegrationPreset | undefined): readonly SecretField[] {
  return (
    preset?.secretFields ?? [
      { key: 'value', label: preset?.credentialLabel || '访问令牌', secret: true, max: 8192 },
    ]
  )
}
export function sourceReferences(
  config: Pick<ConfigWrite, 'modules' | 'quotes'>,
  id: string,
): string[] {
  return [
    ...config.modules
      .filter((m) => Object.values(m.sources).some((s) => s.sourceId === id))
      .map((m) => m.title),
    ...config.quotes.filter((q) => q.provider === id).map((q) => q.symbol),
  ]
}
/** New managed sources follow the preset. Untouched legacy data remains readable and saveable. */
export function integrationWriteIssue(
  next: IntegrationDraft,
  old?: IntegrationSettings,
): SourceWriteIssue | null {
  if (old && (old.provider !== next.provider || old.protocolVersion !== next.protocolVersion))
    return 'SOURCE_TYPE_FIXED'
  const p = integrationPreset(next)
  if (
    Object.entries(next.fieldMappings).some(
      ([key, value]) => !p?.fields.some((f) => f.key === key) && old?.fieldMappings[key] !== value,
    ) ||
    Object.keys(old?.fieldMappings ?? {}).some(
      (key) => !p?.fields.some((f) => f.key === key) && !(key in next.fieldMappings),
    )
  )
    return 'SOURCE_MAPPING_FIXED'
  if (canonical(next.capabilities) !== canonical(old?.capabilities ?? {}))
    return 'SOURCE_CAPABILITIES_READONLY'
  const access = next.access
  const sameTarget =
    old &&
    old.provider === next.provider &&
    old.protocolVersion === next.protocolVersion &&
    old.baseUrl === next.baseUrl
  const sameAuth = sameTarget && JSON.stringify(old.access) === JSON.stringify(next.access)
  if (!access || access.mode === 'legacy')
    return old && sameAuth && next.credential.operation !== 'replace'
      ? null
      : 'SOURCE_ACCESS_REQUIRED'
  if (access.mode === 'private')
    return sameAuth && next.credential.operation === 'keep' ? null : 'SOURCE_ACCESS_REQUIRED'
  if (!p)
    return sameAuth && next.credential.operation === 'keep' ? null : 'SOURCE_PROTOCOL_UNSUPPORTED'
  if (access.authentication !== p.authentication) {
    // Existing protected status endpoints may already use Bearer; never silently change them.
    const compatible =
      p.authentication === 'none' &&
      access.authentication === 'bearer' &&
      sameTarget &&
      old?.access?.mode === access.mode &&
      old.access.authentication === 'bearer'
    if (!compatible) return 'SOURCE_AUTH_MISMATCH'
  }
  if (!p.instanceAddress && next.baseUrl && !fixedPresetTarget(next) && !sameTarget)
    return 'SOURCE_TARGET_FIXED'
  if (
    p.fields.some((f) => f.key === 'status_page_slug') &&
    next.enabled &&
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(next.fieldMappings.status_page_slug ?? '')
  )
    return 'SOURCE_STATUS_PAGE_REQUIRED'
  return null
}
