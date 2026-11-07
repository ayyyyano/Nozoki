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
// Approval, capabilities, secrets and transport instructions are never trusted from a backup.
export const BackupSourceSchema = z.strictObject({
  id: fields.id,
  provider: fields.provider,
  protocolVersion: fields.protocolVersion,
  baseUrl: fields.baseUrl,
  enabled: fields.enabled,
  refreshInterval: fields.refreshInterval,
  fieldMappings: fields.fieldMappings,
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
})
export const BACKUP_FILE_LIMIT = CONFIG_BODY_LIMIT * 2
export type ConfigBackup = z.infer<typeof ConfigBackupSchema>
