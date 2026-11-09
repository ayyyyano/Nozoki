import { BACKGROUND_IMAGE_LIMIT, isUploadedBackgroundUrl } from './background-image.ts'
import { z } from 'zod'
import { MODULE_IDS } from './dashboard.ts'
import { canonicalModules } from '../domain/module-layout.ts'
import { DEFAULT_APPEARANCE } from './appearance.ts'
import {
  DEFAULT_SCHEDULE,
  createUnconfiguredDashboard,
  defaultModules,
} from '../domain/dashboard.ts'
import { parseSourceColor } from '../domain/color-input.ts'
import { normalizeSchedule, ScheduleInputSchema, type ScheduleInput } from '../schedule/index.ts'
import { parseFieldPath, pathPrefix } from './field-paths.ts'
import { isMaterialLinkIcon } from '../icons/material.ts'
import { createTencentSource } from '../quotes/defaults.ts'
import { SourceAccessSchema, managedServiceRoot } from './source-access.ts'

export const VisibilitySchema = z.enum(['public', 'admin'])
export const ModuleIdSchema = z.enum(MODULE_IDS)
export const IdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
export const UtcSchema = z.iso.datetime({ precision: 3 })
export const DecimalSchema = z
  .string()
  .max(128)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
export const DaySchema = z.iso.date()
export const TimezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return value.includes('/') || value === 'UTC'
    } catch {
      return false
    }
  }, 'Invalid IANA timezone')
export const HttpsSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value)
      return u.protocol === 'https:' && !u.username && !u.password
    } catch {
      return false
    }
  }, 'HTTPS URL required')
export const IntegrationUrlSchema = HttpsSchema.refine((value) => {
  const u = new URL(value)
  return (
    !u.search &&
    !u.hash &&
    !['localhost', 'localhost.localdomain'].includes(u.hostname) &&
    !/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(u.hostname) &&
    !/^172\.(?:1[6-9]|2\d|3[01])\./.test(u.hostname)
  )
}, 'A public HTTPS base URL without query or fragment is required')
export const SourceColorSchema = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const color = parseSourceColor(value)
    if (!color) {
      ctx.addIssue({ code: 'custom', message: 'Invalid RGB source' })
      return z.NEVER
    }
    return color
  })
const percent = z.number().finite().min(0).max(100)
export const BackgroundSchema = z
  .strictObject({
    source: z.enum(['off', 'builtin', 'custom', 'uploaded']),
    url: z.union([z.literal(''), HttpsSchema, z.string().refine(isUploadedBackgroundUrl)]),
    layout: z.enum(['banner', 'page']),
    fit: z.enum(['cover', 'contain']),
    x: percent,
    y: percent,
    overlay: percent,
    cardOpacity: percent,
    cardBlur: z.number().finite().min(0).max(20),
  })
  .refine(
    (b) => b.source !== 'custom' || HttpsSchema.safeParse(b.url).success,
    'Custom background needs HTTPS',
  )
  .refine(
    (b) => b.source !== 'uploaded' || isUploadedBackgroundUrl(b.url),
    'Uploaded background needs a site image',
  )
export const ScheduleSchema = ScheduleInputSchema.transform((value): ScheduleInput =>
  'version' in value ? normalizeSchedule(value) : value,
)
export const SiteSettingsSchema = z
  .strictObject({
    siteName: z.string().trim().min(1).max(100),
    appearance: z.strictObject({ design: z.literal('m3'), sourceColor: SourceColorSchema }),
    background: BackgroundSchema,
    schedule: ScheduleSchema,
    timezone: TimezoneSchema,
    configVersion: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .refine((v) => v.timezone === v.schedule.timezone, 'Schedule and site timezone must agree')
export const FieldPolicySchema = z.strictObject({
  enabled: z.boolean(),
  visibility: VisibilitySchema,
})
const FieldPathSchema = z.string().min(1).max(2048)
export const ModuleSettingsSchema = z
  .strictObject({
    id: ModuleIdSchema,
    enabled: z.boolean(),
    title: z.string().trim().min(1).max(100),
    sortOrder: z.number().int().min(0).max(10000),
    visibility: VisibilitySchema,
    guestBehavior: z.enum(['hidden', 'login_hint']),
    fields: z.record(FieldPathSchema, FieldPolicySchema),
    ipVisibility: z.enum(['public', 'hidden', 'admin']).optional(),
    guestBlur: z.boolean().optional(),
    homeServices: z
      .array(z.strictObject({ sourceId: IdSchema, monitorId: z.string().min(1).max(1024) }))
      .max(8)
      .optional(),
    sources: z.record(
      IdSchema,
      z.strictObject({ sourceId: IdSchema, subject: z.string().min(1).max(128) }),
    ),
  })
  .superRefine((value, ctx) => {
    if (
      value.homeServices !== undefined &&
      (value.id !== 'services' ||
        new Set(value.homeServices.map((s) => JSON.stringify([s.sourceId, s.monitorId]))).size !==
          value.homeServices.length)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['homeServices'],
        message: 'Services selection must contain at most eight distinct stable monitors',
      })
    if (value.id !== 'deepseek' && value.guestBlur !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['guestBlur'],
        message: 'Only DeepSeek supports balance blur',
      })
    if (value.id !== 'tailscale' && value.ipVisibility !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['ipVisibility'],
        message: 'Only Tailscale supports IP visibility',
      })
    for (const [path, policy] of Object.entries(value.fields)) {
      const segments = parseFieldPath(value.id, path)
      if (!segments) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields'],
          message: 'Unknown or ambiguous DTO field path',
        })
        continue
      }
      if (policy.visibility !== 'public') continue
      const restricted =
        value.visibility === 'admin' ||
        Object.entries(value.fields).some(
          ([ancestor, p]) =>
            p.visibility === 'admin' &&
            (() => {
              const parsed = parseFieldPath(value.id, ancestor)
              return parsed !== null && pathPrefix(parsed, segments)
            })(),
        )
      if (restricted)
        ctx.addIssue({
          code: 'custom',
          path: ['fields'],
          message: 'Fields cannot loosen parent visibility',
        })
    }
  })
export const QuoteSymbolSchema = z.strictObject({
  market: z.string().regex(/^[A-Z][A-Z0-9_-]{1,15}$/),
  symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.^_-]{0,31}$/),
  displayName: z.string().min(1).max(120),
  provider: IdSchema.nullable(),
  sortOrder: z.number().int().min(0).max(10000),
  enabled: z.boolean(),
  refreshInterval: z.number().int().min(60).max(86400),
})
export const CapabilitySchema = z.strictObject({
  supported: z.boolean(),
  verified: z.boolean(),
  reason: z.string().max(300).optional(),
})
export const CredentialStateSchema = z.strictObject({
  configured: z.boolean(),
  keyVersion: z.string().max(64).nullable(),
  lastUpdatedAt: UtcSchema.nullable(),
})
export const CredentialOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('keep') }),
  z.strictObject({ operation: z.literal('clear') }),
  z.strictObject({
    operation: z.literal('replace'),
    value: z
      .string()
      .min(1)
      .max(8192)
      .refine((v) => v.trim().length > 0),
  }),
])
const IntegrationSettingsBaseSchema = z.strictObject({
  id: IdSchema,
  provider: z.enum([
    'deepseek',
    'deepseek-spend',
    'sleepy',
    'tailscale',
    'cliproxy-bridge',
    'uptime-kuma',
    'uptimeflare',
    'quotes-custom',
  ]),
  protocolVersion: z.string().min(1).max(64),
  baseUrl: HttpsSchema.refine((v) => !new URL(v).search && !new URL(v).hash).nullable(),
  access: SourceAccessSchema.optional(),
  enabled: z.boolean(),
  refreshInterval: z.number().int().min(60).max(86400),
  fieldMappings: z.record(
    IdSchema,
    z
      .string()
      .max(200)
      .regex(/^[a-zA-Z0-9_.*-]+$/),
  ),
  capabilities: z.record(IdSchema, CapabilitySchema),
  credentialState: CredentialStateSchema,
  identityConfigured: z.boolean().optional(),
})
const validAccess = (i: {
  baseUrl: string | null
  access?: z.infer<typeof SourceAccessSchema>
}) => {
  if (!i.baseUrl) return true
  if (!i.access || i.access.mode === 'legacy')
    return IntegrationUrlSchema.safeParse(i.baseUrl).success
  try {
    managedServiceRoot(i.baseUrl, i.access.mode)
    return true
  } catch {
    return false
  }
}
export const IntegrationSettingsSchema = IntegrationSettingsBaseSchema.refine(
  validAccess,
  'Invalid source target',
).refine((i) => !i.enabled || i.baseUrl !== null, 'Enabled integration needs a base URL')
export const IntegrationWriteSchema = IntegrationSettingsBaseSchema.omit({
  credentialState: true,
  identityConfigured: true,
})
  .extend({
    credential: CredentialOperationSchema,
    connectionProof: z.string().max(100).optional(),
    identityCredential: z
      .strictObject({
        operation: z.literal('import'),
        value: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .optional(),
  })
  .refine(validAccess, 'Invalid source target')
  .refine((i) => !i.enabled || i.baseUrl !== null, 'Enabled integration needs a base URL')
export const LinkSettingsSchema = z.strictObject({
  id: IdSchema,
  title: z.string().trim().min(1).max(120),
  url: z
    .string()
    .max(2048)
    .refine((v) => {
      try {
        const u = new URL(v)
        return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
      } catch {
        return false
      }
    }),
  icon: z.string().trim().max(96).refine(isMaterialLinkIcon, 'Unknown xicons Material icon'),
  sortOrder: z.number().int().min(0).max(10000),
  visibility: VisibilitySchema.default('public'),
  enabled: z.boolean(),
})
function validatePackage(
  value: {
    modules: ModuleSettings[]
    quotes: QuoteSymbol[]
    integrations: { id: string }[]
    links: LinkSettings[]
  },
  ctx: z.RefinementCtx,
) {
  if (
    value.modules.length !== MODULE_IDS.length ||
    new Set(value.modules.map((m) => m.id)).size !== MODULE_IDS.length
  )
    ctx.addIssue({
      code: 'custom',
      path: ['modules'],
      message: 'All seven modules must appear once',
    })
  for (const [name, keys] of [
    ['quotes', value.quotes.map((q) => `${q.market}:${q.symbol}:${q.provider ?? ''}`)],
    ['integrations', value.integrations.map((i) => i.id)],
    ['links', value.links.map((l) => l.id)],
  ] as const)
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', path: [name], message: 'Duplicate key' })
  const ids = new Set(value.integrations.map((i) => i.id))
  if (value.modules.some((m) => Object.values(m.sources).some((s) => !ids.has(s.sourceId))))
    ctx.addIssue({ code: 'custom', path: ['modules'], message: 'Unknown integration source' })
}
const common = {
  contractVersion: z.literal(1),
  site: SiteSettingsSchema,
  modules: z.array(ModuleSettingsSchema).length(MODULE_IDS.length).transform(canonicalModules),
  quotes: z.array(QuoteSymbolSchema).max(20),
  links: z.array(LinkSettingsSchema).max(100),
}
export const ConfigSchema = z
  .strictObject({ ...common, integrations: z.array(IntegrationSettingsSchema).max(10) })
  .superRefine(validatePackage)
export const ConfigWriteSchema = z
  .strictObject({ ...common, integrations: z.array(IntegrationWriteSchema).max(10) })
  .superRefine(validatePackage)
export const SaveConfigSchema = z
  .strictObject({
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    config: ConfigWriteSchema,
    backgroundUpload: z
      .string()
      .min(1)
      .max(Math.ceil(BACKGROUND_IMAGE_LIMIT / 3) * 4)
      .optional(),
  })
  .refine(
    (v) => v.expectedVersion === v.config.site.configVersion,
    'Expected version must match the submitted baseline',
  )
export type ModuleSettings = z.infer<typeof ModuleSettingsSchema>
export type QuoteSymbol = z.infer<typeof QuoteSymbolSchema>
export type LinkSettings = z.infer<typeof LinkSettingsSchema>
export type IntegrationSettings = z.infer<typeof IntegrationSettingsSchema>
export type Config = z.infer<typeof ConfigSchema>
export type ConfigWrite = z.infer<typeof ConfigWriteSchema>
export type SaveConfigInput = z.infer<typeof SaveConfigSchema>
export function createDefaultConfig(): Config {
  const legacy = createUnconfiguredDashboard()
  return ConfigSchema.parse({
    contractVersion: 1,
    site: {
      siteName: 'Nozoki',
      appearance: { design: 'm3', sourceColor: '#6750A4' },
      background: structuredClone(DEFAULT_APPEARANCE.background),
      schedule: structuredClone(DEFAULT_SCHEDULE),
      timezone: 'Asia/Shanghai',
      configVersion: 1,
    },
    modules: defaultModules().map((m) => ({
      ...m,
      sources: m.id === 'quotes' ? { main: { sourceId: 'tencent', subject: 'default' } } : {},
      fields:
        m.id === 'activity'
          ? {
              presence: { enabled: false, visibility: 'admin' },
              music: { enabled: false, visibility: 'admin' },
              gaming: { enabled: false, visibility: 'admin' },
            }
          : {},
    })),
    quotes: ['QQQM', 'VOO'].map((symbol, sortOrder) => ({
      market: 'US',
      symbol,
      displayName: symbol === 'QQQM' ? '纳斯达克 100 ETF' : '标普 500 ETF',
      provider: 'tencent',
      sortOrder,
      enabled: true,
      refreshInterval: 300,
    })),
    integrations: [createTencentSource()],
    links: legacy.links.data!.items.map((l) => ({ ...l, enabled: true, visibility: 'public' })),
  })
}
