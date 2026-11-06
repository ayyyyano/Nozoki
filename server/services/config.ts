import {
  backgroundImageHash,
  decodeBackgroundImage,
  BACKGROUND_IMAGE_PATH,
} from '../../shared/contracts/background-image.ts'
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
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { randomToken } from './auth-crypto.ts'
import { parseFieldPath } from '../../shared/contracts/field-paths.ts'
import { TailscaleCredentialsSchema } from '../adapters/tailscale-transport.ts'
import {
  integrationWriteIssue,
  sourceReferences,
  type SourceWriteIssue,
} from '../../shared/integration-presets/index.ts'
export function accountPolicyIds(config: Pick<Config, 'modules'>, sourceId: string) {
  return [
    ...new Set(
      config.modules.flatMap((m) =>
        m.id === 'codex' && m.sources.main?.sourceId === sourceId
          ? Object.keys(m.fields).flatMap((path) => {
              const parts = parseFieldPath('codex', path)
              return (
                parts?.flatMap((part, index) =>
                  part === 'accounts' && parts[index + 1]?.startsWith('@')
                    ? [parts[index + 1]!.slice(1)]
                    : [],
                ) ?? []
              )
            })
          : [],
      ),
    ),
  ]
}
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
      reason?:
        | 'CONFIG_NOT_INITIALIZED'
        | 'CONFIG_BASELINE_INVALID'
        | 'IDENTITY_IMPORT_UNVERIFIED'
        | SourceWriteIssue
    }
export async function readConfig(db: Database): Promise<Config> {
  return (await readStoredState(db)).config
}
/** Internal function only. No unauthenticated HTTP write adapter exists in phase 02. */
export async function saveConfig(
  db: Database,
  value: unknown,
  options: {
    actor: AuditActor
    keys?: CredentialKeyRing
    now?: Date
    request?: ConfigRequest
    verifiedIdentityImports?: readonly string[]
  },
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
    if (
      actor.data.kind === 'admin' &&
      current.config.integrations.some(
        (old) =>
          !config.integrations.some((next) => next.id === old.id) &&
          sourceReferences(config, old.id).length,
      )
    )
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        fieldErrors: ['integrations'],
        reason: 'SOURCE_IN_USE',
      }
    if (
      (parsed.data.backgroundUpload !== undefined ||
        config.site.background.source === 'uploaded') &&
      !(await db.prepare('PRAGMA table_info(site_background_images)').all()).results.length
    )
      return { success: false, code: 'MIGRATIONS_REQUIRED' }
    let backgroundImage: { hash: string; bytes: Uint8Array } | undefined
    if (parsed.data.backgroundUpload !== undefined) {
      const bytes = decodeBackgroundImage(parsed.data.backgroundUpload)
      if (!bytes || config.site.background.source !== 'uploaded')
        return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['site.background'] }
      const hash = await backgroundImageHash(bytes)
      if (config.site.background.url !== '/api/background/' + hash)
        return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['site.background'] }
      backgroundImage = { hash, bytes }
    } else if (config.site.background.source === 'uploaded') {
      const hash = BACKGROUND_IMAGE_PATH.exec(config.site.background.url)![1]!
      const exists = await db
        .prepare('SELECT hash FROM site_background_images WHERE hash=?')
        .bind(hash)
        .first()
      if (!exists)
        return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['site.background'] }
    }
    const stored: StoredIntegration[] = []
    for (const i of config.integrations) {
      const old = current.integrations.find((s) => s.settings.id === i.id)
      const { credential, identityCredential, ...settings } = i
      settings.baseUrl = normalizeServiceTarget(settings.baseUrl)
      settings.access ??= { mode: 'legacy' }
      if (actor.data.kind === 'admin') {
        const issue = integrationWriteIssue(
          { ...i, baseUrl: settings.baseUrl },
          current.config.integrations.find((s) => s.id === i.id),
        )
        if (issue)
          return {
            success: false,
            code: 'VALIDATION_ERROR',
            fieldErrors: ['integrations.' + i.id],
            reason: issue,
          }
      }
      if (settings.access.mode !== 'legacy') {
        const oauth = settings.access.authentication === 'tailscale-oauth'
        if (
          (settings.provider === 'tailscale') !== oauth ||
          (oauth &&
            (settings.access.mode !== 'public' ||
              settings.baseUrl !== 'https://api.tailscale.com/' ||
              settings.protocolVersion !== 'tailscale-devices-v2'))
        )
          return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['integrations.access'] }
        if (oauth && credential.operation === 'replace') {
          try {
            TailscaleCredentialsSchema.parse(JSON.parse(credential.value))
          } catch {
            return {
              success: false,
              code: 'VALIDATION_ERROR',
              fieldErrors: ['integrations.credentials'],
            }
          }
        }
      }
      if (
        settings.access.mode !== 'legacy' &&
        settings.access.authentication === 'bearer' &&
        credential.operation === 'replace' &&
        /[\r\n\u0000]/.test(credential.value)
      )
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          fieldErrors: ['integrations.credentials'],
        }
      if (
        settings.access.mode !== 'legacy' &&
        settings.provider === 'cliproxy-bridge' &&
        settings.access.authentication !== 'bearer'
      )
        return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['integrations.access'] }
      if (
        settings.access.mode !== 'legacy' &&
        settings.access.approved &&
        settings.access.approvedTarget !== sourceTargetKey(settings, settings.access)
      )
        return { success: false, code: 'VALIDATION_ERROR', fieldErrors: ['integrations.access'] }
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
      if (actor.data.kind === 'admin' && targetChanged)
        settings.capabilities = Object.fromEntries(
          Object.entries(settings.capabilities).map(([key, c]) => [key, { ...c, verified: false }]),
        )
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
      let identityEnvelope = old?.identityEnvelope ?? null
      const policyIds = new Set([
        ...accountPolicyIds(current.config, settings.id),
        ...accountPolicyIds(config, settings.id),
      ])
      if (identityCredential) {
        if (
          identityEnvelope ||
          settings.access.mode !== 'public' ||
          settings.provider !== 'cliproxy-bridge' ||
          settings.protocolVersion !== 'cliproxy-v8-accounts'
        )
          return {
            success: false,
            code: 'VALIDATION_ERROR',
            fieldErrors: ['integrations.identityCredential'],
          }
        if (policyIds.size && !options.verifiedIdentityImports?.includes(settings.id))
          return {
            success: false,
            code: 'VALIDATION_ERROR',
            reason: 'IDENTITY_IMPORT_UNVERIFIED',
            fieldErrors: ['modules.codex.fields'],
          }
        identityEnvelope = await encryptCredential(
          i.id,
          settings.provider + ':identity',
          identityCredential.value,
          options.keys,
          now,
        )
      }
      if (
        !identityEnvelope &&
        settings.access.mode !== 'legacy' &&
        settings.provider === 'cliproxy-bridge' &&
        settings.protocolVersion === 'cliproxy-v8-accounts' &&
        policyIds.size > 0
      )
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          reason: 'IDENTITY_IMPORT_UNVERIFIED',
          fieldErrors: ['integrations.identityCredential'],
        }
      if (
        settings.access.mode !== 'legacy' &&
        settings.provider === 'cliproxy-bridge' &&
        settings.protocolVersion === 'cliproxy-v8-accounts' &&
        !identityEnvelope
      )
        identityEnvelope = await encryptCredential(
          i.id,
          settings.provider + ':identity',
          randomToken(),
          options.keys,
          now,
        )
      stored.push({ settings, envelope, identityEnvelope })
    }
    const credentialChanged = stored.some(
      (i) =>
        canonical(i.envelope) !==
          canonical(
            current.integrations.find((old) => old.settings.id === i.settings.id)?.envelope ?? null,
          ) ||
        canonical(i.identityEnvelope ?? null) !==
          canonical(
            current.integrations.find((old) => old.settings.id === i.settings.id)
              ?.identityEnvelope ?? null,
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
    if (
      stored.some(
        (i) =>
          canonical(i.settings.access) !==
          canonical(
            current.integrations.find((old) => old.settings.id === i.settings.id)?.settings.access,
          ),
      )
    )
      changedFields.push('integrations.access')
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
      backgroundImage,
      current.config.site.background.source === 'uploaded',
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
