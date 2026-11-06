import { savedRequest } from '../repositories/config-requests.ts'
import type { AuthSession } from './sessions.ts'
import { mac, hex } from './auth-crypto.ts'
import { canonical, validRequestKey } from '../../shared/contracts/admin.ts'
import { SaveConfigSchema } from '../../shared/contracts/config.ts'
import { AuthError, type AuthEnvironment } from './auth-settings.ts'
import { saveConfig, accountPolicyIds } from './config.ts'
import { importCredentialKey, encryptCredential } from './credentials.ts'
import { readStoredState } from '../repositories/config.ts'
import { readManagedSource } from '../collection/managed-read.ts'
import {
  reserveIntegrationTest,
  releaseIntegrationTest,
  deferIntegrationTest,
} from './integration-test-limits.ts'
import type { Database } from '../types/database.ts'

export async function saveAdminConfig(
  db: Database,
  value: unknown,
  key: string,
  session: AuthSession,
  env: AuthEnvironment,
) {
  if (!validRequestKey(key)) throw new AuthError(400, 'INVALID_IDEMPOTENCY_KEY')
  const parsed = SaveConfigSchema.safeParse(value)
  if (!parsed.success)
    return {
      success: false as const,
      code: 'VALIDATION_ERROR' as const,
      fieldErrors: [...new Set(parsed.error.issues.map((i) => i.path.join('.')))],
    }
  const scope = hex(
    await mac(session.settings.rateKey, [
      'nozoki-config-scope-v1',
      session.settings.fingerprint,
      session.hash,
    ]),
  )
  const digest = hex(
    await mac(session.settings.rateKey, [
      'nozoki-config-request-v1',
      scope,
      canonical(parsed.data),
    ]),
  )
  const actor = hex(
    await mac(session.settings.rateKey, ['nozoki-admin-actor-v1', session.settings.email]),
  )
  const request = { scope, key: key.toLowerCase(), mac: digest }
  const prior = await savedRequest(db, request, new Date().toISOString())
  if (prior) return prior
  let keys
  if (
    parsed.data.config.integrations.some(
      (i) =>
        i.credential.operation === 'replace' ||
        (i.access &&
          i.access.mode !== 'legacy' &&
          i.provider === 'cliproxy-bridge' &&
          i.protocolVersion === 'cliproxy-v8-accounts'),
    )
  ) {
    const secret = env.INTEGRATION_ENCRYPTION_KEY,
      version = env.INTEGRATION_KEY_VERSION
    if (
      typeof secret !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
      typeof version !== 'string'
    )
      return {
        success: false as const,
        code: 'VALIDATION_ERROR' as const,
        fieldErrors: ['integrations.credentials'],
        reason: 'CREDENTIAL_KEY_UNAVAILABLE',
      }
    try {
      keys = await importCredentialKey(
        version,
        Uint8Array.from(atob(secret.replaceAll('-', '+').replaceAll('_', '/') + '='), (c) =>
          c.charCodeAt(0),
        ),
      )
    } catch {
      return {
        success: false as const,
        code: 'VALIDATION_ERROR' as const,
        fieldErrors: ['integrations.credentials'],
        reason: 'CREDENTIAL_KEY_UNAVAILABLE',
      }
    }
  }
  const verifiedIdentityImports: string[] = []
  if (parsed.data.config.integrations.some((i) => i.identityCredential)) {
    const current = await readStoredState(db)
    if (current.config.site.configVersion !== parsed.data.expectedVersion)
      return { success: false as const, code: 'CONFIG_CONFLICT' as const }
    for (const source of parsed.data.config.integrations) {
      if (!source.identityCredential) continue
      const old = current.integrations.find((i) => i.settings.id === source.id)
      const ids = new Set([
        ...accountPolicyIds(current.config, source.id),
        ...accountPolicyIds(parsed.data.config, source.id),
      ])
      if (
        old?.identityEnvelope ||
        source.provider !== 'cliproxy-bridge' ||
        source.protocolVersion !== 'cliproxy-v8-accounts' ||
        source.access?.mode !== 'public'
      )
        return {
          success: false as const,
          code: 'VALIDATION_ERROR' as const,
          fieldErrors: ['integrations.identityCredential'],
        }
      if (!ids.size) continue
      const slot = await reserveIntegrationTest(db, session, source.id)
      try {
        const { credential, identityCredential, ...settings } = source
        const now = new Date().toISOString()
        // Reusing an encrypted bearer is safe only at the unchanged provider and root.
        if (
          credential.operation === 'keep' &&
          old?.envelope &&
          (old.settings.provider !== source.provider || old.settings.baseUrl !== source.baseUrl)
        )
          throw new Error()
        const envelope =
          credential.operation === 'replace'
            ? await encryptCredential(source.id, source.provider, credential.value, keys, now)
            : credential.operation === 'keep'
              ? (old?.envelope ?? null)
              : null
        const identity = await encryptCredential(
          source.id,
          source.provider + ':identity',
          identityCredential.value,
          keys,
          now,
        )
        const result = await readManagedSource(
          {
            ...settings,
            credentialState: {
              configured: !!envelope,
              keyVersion: envelope?.keyVersion ?? null,
              lastUpdatedAt: envelope?.updatedAt ?? null,
            },
          },
          envelope,
          identity,
          env,
          new Date(now),
          'probe',
        )
        if (result.code === 'RATE_LIMITED' && result.retryAfterSeconds)
          await deferIntegrationTest(db, slot.sourceHash, result.retryAfterSeconds)
        const data = result.views.codex?.data as { accounts?: { id: string }[] } | undefined
        const returned = new Set(data?.accounts?.map((a) => a.id) ?? [])
        if (result.code || ![...ids].every((id) => returned.has(id))) throw new Error()
        verifiedIdentityImports.push(source.id)
      } catch {
        return {
          success: false as const,
          code: 'VALIDATION_ERROR' as const,
          reason: 'IDENTITY_IMPORT_UNVERIFIED' as const,
          fieldErrors: ['integrations.identityCredential'],
        }
      } finally {
        await releaseIntegrationTest(db, slot)
      }
    }
  }
  return saveConfig(db, parsed.data, {
    actor: { kind: 'admin', id: actor },
    keys,
    request,
    verifiedIdentityImports,
  })
}
