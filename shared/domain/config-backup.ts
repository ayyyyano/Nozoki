import {
  ConfigBackupSchema,
  BACKUP_FILE_LIMIT,
  type ConfigBackup,
} from '../contracts/config-backup.ts'
import {
  ConfigWriteSchema,
  createDefaultConfig,
  type Config,
  type ConfigWrite,
} from '../contracts/config.ts'
import { CONFIG_BODY_LIMIT, canonical, editableConfig } from '../contracts/admin.ts'
import { backgroundImageHash, decodeBackgroundImage } from '../contracts/background-image.ts'
import {
  integrationPreset,
  integrationWriteIssue,
  type IntegrationDraft,
} from '../integration-presets/index.ts'
import { bindSources, duplicateSourceType } from '../integration-presets/bindings.ts'
import { sourceConnection } from '../integration-presets/connection.ts'
import { parseFieldPath } from '../contracts/field-paths.ts'

export interface ConfigImportPlan {
  config: ConfigWrite
  backgroundUpload?: { url: string; data: string }
  retainedSources: number
  restrictedModules: string[]
}
export function createConfigBackup(
  config: Config,
  backgroundImage?: string,
  now = new Date(),
): ConfigBackup {
  const { configVersion: _version, ...site } = config.site
  return ConfigBackupSchema.parse({
    format: 'nozoki-config',
    version: 1,
    exportedAt: now.toISOString(),
    config: {
      ...config,
      site,
      integrations: config.integrations.map((source) => ({
        id: source.id,
        provider: source.provider,
        protocolVersion: source.protocolVersion,
        baseUrl: source.baseUrl,
        enabled: source.enabled,
        refreshInterval: source.refreshInterval,
        fieldMappings: source.fieldMappings,
      })),
    },
    ...(backgroundImage !== undefined ? { backgroundImage } : {}),
  })
}
/** This parser never performs network requests or grants access to an imported address. */
export async function prepareConfigImport(
  text: string,
  baseline: Config,
): Promise<ConfigImportPlan> {
  if (new TextEncoder().encode(text).length > BACKUP_FILE_LIMIT) throw new Error('BACKUP_TOO_LARGE')
  const backup = ConfigBackupSchema.parse(JSON.parse(text))
  const oldDraft = editableConfig(baseline)
  const imported = backup.config
  const remap = new Map<string, string>()
  const used = new Set<string>()
  const changed = new Set<string>()
  const sources = imported.integrations.map((item): IntegrationDraft => {
    if (used.has(item.id)) throw new Error('BACKUP_DUPLICATE_SOURCE')
    used.add(item.id)
    const preset = integrationPreset(item)
    const old =
      baseline.integrations.find(
        (s) =>
          s.id === item.id &&
          s.provider === item.provider &&
          s.protocolVersion === item.protocolVersion,
      ) ?? baseline.integrations.find((s) => preset && integrationPreset(s)?.id === preset.id)
    const id = old?.id ?? preset?.id ?? item.id
    remap.set(item.id, id)
    const original = oldDraft.integrations.find((s) => s.id === old?.id)
    if (!preset) {
      if (
        !original ||
        canonical({ ...item, id }) !==
          canonical({
            id: original.id,
            provider: original.provider,
            protocolVersion: original.protocolVersion,
            baseUrl: original.baseUrl,
            enabled: original.enabled,
            refreshInterval: original.refreshInterval,
            fieldMappings: original.fieldMappings,
          })
      )
        throw new Error('BACKUP_UNSUPPORTED_SOURCE')
      return original
    }
    const next: IntegrationDraft = {
      ...item,
      id,
      capabilities: old?.capabilities ?? {},
      credential: { operation: 'keep' },
      access: {
        mode: 'public',
        authentication:
          old?.baseUrl === item.baseUrl && old.access?.mode === 'public'
            ? old.access.authentication
            : preset.authentication,
        approved: false,
        approvedTarget: null,
      },
    }
    if (original && sourceConnection(next) === sourceConnection(original)) {
      next.access = original.access
    } else {
      next.credential = { operation: 'clear' }
      changed.add(id)
    }
    const issue = integrationWriteIssue(
      next,
      baseline.integrations.find((s) => s.id === id),
    )
    if (issue) throw new Error(issue)
    return next
  })
  if (
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    duplicateSourceType(sources, baseline.integrations)
  )
    throw new Error('BACKUP_DUPLICATE_SOURCE')
  // Omitted existing sources are retained, disabled. This preserves protected history and ciphertext.
  const retained = oldDraft.integrations
    .filter((s) => !sources.some((i) => i.id === s.id))
    .map((s) => ({ ...s, enabled: false }))
  const restrictedModules: string[] = []
  const bound = bindSources({
    ...imported,
    site: { ...imported.site, configVersion: baseline.site.configVersion },
    integrations: [...sources, ...retained],
    modules: imported.modules.map((module) => ({
      ...module,
      sources: Object.fromEntries(
        Object.entries(module.sources).map(([key, ref]) => [
          key,
          { ...ref, sourceId: remap.get(ref.sourceId) ?? ref.sourceId },
        ]),
      ),
    })),
    quotes: imported.quotes.map((q) => ({
      ...q,
      provider: q.provider ? (remap.get(q.provider) ?? null) : null,
    })),
  })
  const config = ConfigWriteSchema.parse({
    ...bound,
    modules: bound.modules.map((module) => {
      const previous = baseline.modules.find((m) => m.id === module.id)
      const foreignRules = Object.entries(module.fields).some(
        ([key, policy]) =>
          parseFieldPath(module.id, key)?.some((part) => part.startsWith('@')) &&
          canonical(previous?.fields[key]) !== canonical(policy),
      )
      if (!foreignRules && !Object.values(module.sources).some((ref) => changed.has(ref.sourceId)))
        return module
      restrictedModules.push(module.title)
      return {
        ...module,
        visibility: 'admin' as const,
        guestBehavior: 'login_hint' as const,
        fields: Object.fromEntries(
          Object.entries(module.fields)
            .filter(
              ([key]) => !parseFieldPath(module.id, key)?.some((part) => part.startsWith('@')),
            )
            .map(([key, policy]) => [key, { ...policy, visibility: 'admin' as const }]),
        ),
      }
    }),
  })
  let backgroundUpload: ConfigImportPlan['backgroundUpload']
  if (config.site.background.source === 'uploaded') {
    const bytes = backup.backgroundImage && decodeBackgroundImage(backup.backgroundImage)
    if (
      !bytes ||
      config.site.background.url !== '/api/background/' + (await backgroundImageHash(bytes))
    )
      throw new Error('BACKUP_INVALID_IMAGE')
    backgroundUpload = { url: config.site.background.url, data: backup.backgroundImage! }
  } else if (backup.backgroundImage !== undefined) throw new Error('BACKUP_INVALID_IMAGE')
  if (
    new TextEncoder().encode(
      JSON.stringify({
        config,
        expectedVersion: baseline.site.configVersion,
        ...(backgroundUpload ? { backgroundUpload: backgroundUpload.data } : {}),
      }),
    ).length > CONFIG_BODY_LIMIT
  )
    throw new Error('BACKUP_TOO_LARGE')
  return { config, backgroundUpload, retainedSources: retained.length, restrictedModules }
}
/** Restore UI defaults without deleting source identities, secrets, protected history or sessions. */
export function globalDefaultConfig(baseline: Config): ConfigWrite {
  const defaults = editableConfig(createDefaultConfig())
  defaults.site.configVersion = baseline.site.configVersion
  defaults.integrations = editableConfig(baseline).integrations.map((source) => ({
    ...source,
    enabled:
      integrationPreset(source)?.id === 'tencent' &&
      source.access?.mode === 'public' &&
      source.access.approved,
  }))
  return ConfigWriteSchema.parse(bindSources(defaults))
}
