import { z } from 'zod'
import {
  IntegrationWriteSchema,
  SiteSettingsSchema,
  ModuleSettingsSchema,
  QuoteSymbolSchema,
  LinkSettingsSchema,
  UtcSchema,
} from './config.ts'
import { CONFIG_BODY_LIMIT } from './admin.ts'
import { BACKGROUND_IMAGE_LIMIT } from './background-image.ts'
import { MODULE_IDS } from './dashboard.ts'

const fields = IntegrationWriteSchema.shape
const { configVersion: _version, ...siteFields } = SiteSettingsSchema.shape
// Approval, capabilities and transport instructions are never trusted from a backup.
export const BackupSourceSchema = z.strictObject({
  id: fields.id,
  provider: fields.provider,
  protocolVersion: fields.protocolVersion,
  baseUrl: fields.baseUrl,
  enabled: fields.enabled,
  refreshInterval: fields.refreshInterval,
  fastUptimeFlare: z.literal(true).optional(),
  fieldMappings: fields.fieldMappings,
  credentialPlain: fields.credential.options[2].shape.value.optional(),
  identityPlain: fields.identityCredential.unwrap().shape.value.optional(),
})
/** Collected-history archive; export-only. Import rejects it: rows bind to per-deployment source ids. */
export const BackupHistorySchema = z.strictObject({
  exportedAt: UtcSchema,
  balanceObservations: z
    .array(
      z.strictObject({
        sourceId: z.string().max(100),
        seriesRevision: z.string().max(100),
        currency: z.string().length(3),
        observedAt: z.string().nullable(),
        collectedAt: UtcSchema,
        total: z.string().max(128),
        granted: z.string().max(128),
        toppedUp: z.string().max(128),
      }),
    )
    .max(20000),
  dailyUsage: z
    .array(
      z.strictObject({
        sourceId: z.string().max(100),
        day: z.iso.date(),
        timezone: z.string().max(100),
        currency: z.string().length(3),
        dimension: z.string().max(100),
        amount: z.string().max(128),
        updatedAt: UtcSchema,
      }),
    )
    .max(20000),
  codexUsageDays: z
    .array(
      z.strictObject({
        sourceId: z.string().max(100),
        day: z.iso.date(),
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
        reasoning: z.number().int().nonnegative(),
        cached: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        requests: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        updatedAt: UtcSchema,
      }),
    )
    .max(20000),
})
export const ConfigBackupSchema = z.strictObject({
  format: z.literal('nozoki-config'),
  version: z.literal(1),
  exportedAt: UtcSchema,
  config: z.strictObject({
    contractVersion: z.literal(1),
    site: z.strictObject(siteFields).refine((s) => s.timezone === s.schedule.timezone),
    modules: z.array(ModuleSettingsSchema).length(MODULE_IDS.length),
    quotes: z.array(QuoteSymbolSchema).max(20),
    links: z.array(LinkSettingsSchema).max(100),
    integrations: z.array(BackupSourceSchema).max(10),
  }),
  backgroundImage: z
    .string()
    .max(Math.ceil(BACKGROUND_IMAGE_LIMIT / 3) * 4)
    .optional(),
  history: BackupHistorySchema.optional(),
})
export const BACKUP_FILE_LIMIT = CONFIG_BODY_LIMIT * 2
/** History archives roughly double the export size budget; credentials stay within the base limit. */
export const BACKUP_HISTORY_FILE_LIMIT = CONFIG_BODY_LIMIT * 4
export type ConfigBackup = z.infer<typeof ConfigBackupSchema>
export type BackupHistory = z.infer<typeof BackupHistorySchema>
