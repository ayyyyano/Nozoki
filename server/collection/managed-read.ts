import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import type { CredentialEnvelope } from '../services/credentials.ts'
import { decryptCredential } from '../services/credentials.ts'
import { credentialKeys } from '../services/credential-keys.ts'
import { hmacKey } from '../services/auth-crypto.ts'
import { assertManagedSource } from '../adapters/source-connector.ts'
import { managedCodexQuotaReader, managedTransport } from '../adapters/managed-transport.ts'
import { AdapterError } from '../adapters/types.ts'
import { runAdapter } from '../adapters/registry.ts'
import type { TransportOptions } from '../adapters/transport.ts'
import type { UsageDay } from '../adapters/codex-usage.ts'
import type { CodexQuotaAccount } from '../adapters/codex-quota.ts'
export async function readManagedSource(
  source: IntegrationSettings,
  envelope: CredentialEnvelope | null,
  identityEnvelope: CredentialEnvelope | null | undefined,
  env: Record<string, unknown>,
  now: Date,
  mode: 'read' | 'probe',
  options: TransportOptions & {
    codexUsageDays?: readonly UsageDay[]
    previousCodexQuota?: readonly CodexQuotaAccount[]
    scheduledCodexQuota?: boolean
  } = {},
) {
  const access = assertManagedSource(source)
  if (access.mode !== 'public') throw new AdapterError('DESTINATION_BLOCKED')
  let credential: string | undefined, identityKey: CryptoKey | undefined
  try {
    if (access.authentication !== 'none' || source.provider === 'cliproxy-bridge') {
      if (!envelope) throw new AdapterError('AUTH_REQUIRED')
      try {
        const ring = await credentialKeys(env)
        credential = await decryptCredential(source.id, source.provider, envelope, ring)
        if (
          source.provider === 'cliproxy-bridge' &&
          source.protocolVersion === 'cliproxy-v8-accounts'
        ) {
          if (!identityEnvelope) throw new Error()
          identityKey = await hmacKey(
            await decryptCredential(
              source.id,
              source.provider + ':identity',
              identityEnvelope,
              ring,
            ),
          )
        }
      } catch {
        throw new AdapterError('CREDENTIAL_UNAVAILABLE')
      }
    }
    if (source.provider === 'cliproxy-bridge' && access.authentication !== 'bearer')
      throw new AdapterError('AUTH_REQUIRED')
    const transport = managedTransport(source, credential, env, options)
    return await runAdapter(
      {
        source,
        transport,
        now,
        signal: options.signal,
        quoteSymbols: options.quoteSymbols,
        codexUsageDays: options.codexUsageDays,
        previousCodexQuota: options.previousCodexQuota,
        readCodexQuota:
          mode === 'read' && options.scheduledCodexQuota
            ? managedCodexQuotaReader(source, credential, options)
            : undefined,
        identityKey,
      },
      mode,
    )
  } finally {
    credential = undefined
  }
}
