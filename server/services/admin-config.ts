import { savedRequest } from '../repositories/config-requests.ts'
import type { AuthSession } from './sessions.ts'
import { mac, hex } from './auth-crypto.ts'
import { canonical, validRequestKey } from '../../shared/contracts/admin.ts'
import { SaveConfigSchema } from '../../shared/contracts/config.ts'
import { AuthError, type AuthEnvironment } from './auth-settings.ts'
import { saveConfig } from './config.ts'
import { importCredentialKey } from './credentials.ts'
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
  if (parsed.data.config.integrations.some((i) => i.credential.operation === 'replace')) {
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
  return saveConfig(db, parsed.data, {
    actor: { kind: 'admin', id: actor },
    keys,
    request,
  })
}
