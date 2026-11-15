import { z } from 'zod'
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { canonical } from '../../shared/contracts/admin.ts'
import { sourceConnection } from '../../shared/integration-presets/connection.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { hex } from './auth-crypto.ts'
import type { CredentialEnvelope } from './credentials.ts'

export const StoredVerificationSchema = z.strictObject({
  verifiedAt: z.iso.datetime(),
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})
export type StoredVerification = z.infer<typeof StoredVerificationSchema>

export async function sourceVerificationFingerprint(
  source: Omit<IntegrationSettings, 'credentialState'>,
  envelope: CredentialEnvelope | null,
) {
  if (
    source.access?.mode !== 'public' ||
    !source.access.approved ||
    source.access.approvedTarget !== sourceTargetKey(source, source.access)
  )
    return null
  // Bind the result to the saved connection and its encrypted credential revision.
  const input = canonical([
    'nozoki-source-verification-v1',
    sourceConnection({ ...source, credential: { operation: 'keep' } }),
    envelope,
  ])
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
}
