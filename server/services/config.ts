import {
  canonical,
  orderedConfig,
  editableConfig,
  CONFIG_BODY_LIMIT,
} from '../../shared/contracts/admin.ts'
import { savedRequest, type ConfigRequest } from '../repositories/config-requests.ts'
import { SaveConfigSchema, type Config } from '../../shared/contracts/config.ts'
import { z } from 'zod'
import {
  readStoredState,
  commitConfig,
  type AuditActor,
  type StoredIntegration,
} from '../repositories/config.ts'
import { DataLayerError, type Database } from '../types/database.ts'
import { encryptCredential, type CredentialKeyRing } from './credentials.ts'
import { normalizeServiceTarget } from './service-target.ts'
export type SaveResult =
  | { success: true; configVersion: number; changed?: boolean; replayed?: boolean }
  | {
      success: false
      code:
        | 'CONFIG_CONFLICT'
        | 'IDEMPOTENCY_CONFLICT'
        | 'VALIDATION_ERROR'
        | 'DATABASE_ERROR'
        | 'MIGRATIONS_REQUIRED'
      fieldErrors?: string[]
      reason?: 'CONFIG_NOT_INITIALIZED' | 'CONFIG_BASELINE_INVALID'
    }
export async function readConfig(db: Database): Promise<Config> {
  return (await readStoredState(db)).config
}
/** Internal function only. No unauthenticated HTTP write adapter exists in phase 02. */
export async function saveConfig(
  db: Database,
  value: unknown,
  options: { actor: AuditActor; keys?: CredentialKeyRing; now?: Date; request?: ConfigRequest },
): Promise<SaveResult> {
  let parsed: ReturnType<typeof SaveConfigSchema.safeParse>
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > CONFIG_BODY_LIMIT)
      return { success: false, code: 'VALIDATION_ERROR' }
    parsed = SaveConfigSchema.safeParse(value)
  } catch {
    return { success: false, code: 'VALIDATION_ERROR' }
  }
  if (!parsed.success)
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      fieldErrors: [
        ...new Set(
          parsed.error.issues.map((i) =>
            ['site', 'modules', 'quotes', 'integrations', 'links'].includes(String(i.path[0]))
              ? String(i.path[0])
              : 'config',
          ),
        ),
      ],
    }
  const { config, expectedVersion } = parsed.data
  const actor = z
    .strictObject({
      kind: z.enum(['system', 'unattributed', 'admin']),
      id: z.string().max(64).optional(),
    })
    .safeParse(options.actor)
  if (
    !actor.success ||
    (actor.data.kind === 'admin' && !/^[a-f0-9]{64}$/.test(actor.data.id ?? ''))
  )
    return { success: false, code: 'VALIDATION_ERROR' }
  if (options.now && !Number.isFinite(options.now.getTime()))
    return { success: false, code: 'VALIDATION_ERROR' }
  const now = (options.now ?? new Date()).toISOString()
  try {
    if (options.request) {
      const prior = await savedRequest(db, options.request, now)
      if (prior) return prior
    }
    const current = await readStoredState(db)
    if (current.storageMode === 'read-only') return { success: false, code: 'MIGRATIONS_REQUIRED' }
    if (current.config.site.configVersion !== expectedVersion)
      return { success: false, code: 'CONFIG_CONFLICT' }
    const stored: StoredIntegration[] = []
    for (const i of config.integrations) {
      const old = current.integrations.find((s) => s.settings.id === i.id)
      const { credential, ...settings } = i
      settings.baseUrl = normalizeServiceTarget(settings.baseUrl)
      if (
        credential.operation === 'keep' &&
        old?.envelope &&
        (old.settings.provider !== i.provider ||
          normalizeServiceTarget(old.settings.baseUrl) !== normalizeServiceTarget(i.baseUrl))
      )
        return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['integrations'] }
      const targetChanged =
        !!old &&
        (old.settings.provider !== i.provider ||
          normalizeServiceTarget(old.settings.baseUrl) !== settings.baseUrl)
      if (
        actor.data.kind === 'admin' &&
        Object.entries(settings.capabilities).some(
          ([key, c]) =>
            c.verified &&
            (targetChanged ||
              !old?.settings.capabilities[key]?.verified ||
              canonical(c) !== canonical(old.settings.capabilities[key])),
        )
      )
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          fieldErrors: ['integrations.capabilities'],
        }
      const envelope =
        credential.operation === 'replace'
          ? await encryptCredential(i.id, i.provider, credential.value, options.keys, now)
          : credential.operation === 'clear'
            ? null
            : (old?.envelope ?? null)
      stored.push({ settings, envelope })
    }
    const credentialChanged = stored.some(
      (i) =>
        canonical(i.envelope) !==
        canonical(
          current.integrations.find((old) => old.settings.id === i.settings.id)?.envelope ?? null,
        ),
    )
    const changedFields: string[] = []
    for (const key of ['siteName', 'appearance', 'background', 'schedule', 'timezone'] as const)
      if (JSON.stringify(current.config.site[key]) !== JSON.stringify(config.site[key]))
        changedFields.push(`site.${key}`)
    for (const key of ['modules', 'quotes', 'links'] as const)
      if (JSON.stringify(current.config[key]) !== JSON.stringify(config[key]))
        changedFields.push(key)
    if (
      JSON.stringify(current.integrations.map((i) => i.settings)) !==
      JSON.stringify(stored.map((i) => i.settings))
    )
      changedFields.push('integrations')
    if (credentialChanged) changedFields.push('integrations.credentials')
    const comparable = {
      ...config,
      integrations: stored.map((i) => ({
        ...i.settings,
        credential: { operation: 'keep' as const },
      })),
    }
    const changed =
      credentialChanged ||
      canonical(orderedConfig(comparable)) !==
        canonical(orderedConfig(editableConfig(current.config)))
    // HTTP no-op still takes the database version guard and records its retry result atomically.
    await commitConfig(
      db,
      config,
      expectedVersion,
      stored,
      actor.data,
      now,
      changedFields,
      options.request,
      options.request ? changed : true,
    )
    const nextVersion = expectedVersion + Number(changed)
    return options.request
      ? { success: true, configVersion: nextVersion, changed }
      : { success: true, configVersion: nextVersion }
  } catch (e) {
    if (options.request) {
      try {
        const prior = await savedRequest(db, options.request, now)
        if (prior) return prior
      } catch {
        /* fail closed below */
      }
    }
    // Only inspect fixed markers locally. Never return SQL, stacks, URLs or upstream values.
    const message = e instanceof Error ? e.message : ''
    if (message.includes('NOZOKI_CONFIG_CONFLICT'))
      return { success: false, code: 'CONFIG_CONFLICT' }
    if (message.includes('NOZOKI_SOURCE_HAS_HISTORY'))
      return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['integrations'] }
    if (message === 'CREDENTIAL_KEY_UNAVAILABLE')
      return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['integrations'] }
    if (
      e instanceof DataLayerError &&
      ['CONFIG_NOT_INITIALIZED', 'CONFIG_BASELINE_INVALID'].includes(e.code)
    )
      return {
        success: false,
        code: 'DATABASE_ERROR',
        reason: e.code as 'CONFIG_NOT_INITIALIZED' | 'CONFIG_BASELINE_INVALID',
      }
    if (e instanceof DataLayerError || e instanceof Error)
      return { success: false, code: 'DATABASE_ERROR' }
    return { success: false, code: 'DATABASE_ERROR' }
  }
}
