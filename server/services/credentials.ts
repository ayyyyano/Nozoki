import { z } from 'zod'
import { UtcSchema, type IntegrationSettings } from '../../shared/contracts/config.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
export const CredentialEnvelopeSchema = z.strictObject({
  algorithm: z.literal('AES-GCM'),
  ciphertext: z
    .string()
    .min(24)
    .max(12000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  iv: z
    .string()
    .length(16)
    .regex(/^[A-Za-z0-9+/]{16}$/),
  keyVersion: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  updatedAt: UtcSchema,
})
export type CredentialEnvelope = z.infer<typeof CredentialEnvelopeSchema>
export interface CredentialKeyRing {
  activeVersion: string
  keys: Record<string, CryptoKey>
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
const aad = (id: string, provider: string, version: string) =>
  new TextEncoder().encode(JSON.stringify(['nozoki-credential-v1', id, provider, version]))
export async function importCredentialKey(
  version: string,
  raw: Uint8Array,
): Promise<CredentialKeyRing> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(version) || raw.byteLength !== 32)
    throw new Error('CREDENTIAL_KEY_INVALID')
  return {
    activeVersion: version,
    keys: {
      [version]: await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]),
    },
  }
}
export async function encryptCredential(
  id: string,
  provider: string,
  value: string,
  ring: CredentialKeyRing | undefined,
  now: string,
): Promise<CredentialEnvelope> {
  const version = ring?.activeVersion,
    key = version && ring?.keys[version]
  if (!key || !version) throw new Error('CREDENTIAL_KEY_UNAVAILABLE')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(id, provider, version), tagLength: 128 },
    key,
    new TextEncoder().encode(value),
  )
  return CredentialEnvelopeSchema.parse({
    algorithm: 'AES-GCM',
    ciphertext: encode(new Uint8Array(ciphertext)),
    iv: encode(iv),
    keyVersion: version,
    updatedAt: now,
  })
}
export async function decryptCredential(
  id: string,
  provider: string,
  value: unknown,
  ring: CredentialKeyRing,
): Promise<string> {
  const envelope = CredentialEnvelopeSchema.parse(value),
    key = ring.keys[envelope.keyVersion]
  if (!key) throw new Error('CREDENTIAL_KEY_VERSION_UNAVAILABLE')
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decode(envelope.iv),
        additionalData: aad(id, provider, envelope.keyVersion),
        tagLength: 128,
      },
      key,
      decode(envelope.ciphertext),
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new Error('CREDENTIAL_AUTHENTICATION_FAILED')
  }
}
export function credentialState(envelope: CredentialEnvelope | null) {
  return {
    configured: envelope !== null,
    keyVersion: envelope?.keyVersion ?? null,
    lastUpdatedAt: envelope?.updatedAt ?? null,
  }
}
/** Configuration completeness, never a claim of verified network/API capabilities. */
export function isIntegrationConfigured(i: IntegrationSettings): boolean {
  if (i.access && i.access.mode !== 'legacy')
    return (
      i.enabled &&
      i.baseUrl !== null &&
      i.access.approved &&
      i.access.approvedTarget === sourceTargetKey(i, i.access) &&
      (i.access.authentication === 'none' || i.credentialState.configured)
    )
  return (
    i.enabled &&
    i.baseUrl !== null &&
    (!['deepseek', 'cliproxy-bridge', 'tailscale'].includes(i.provider) ||
      (i.provider === 'cliproxy-bridge' && i.protocolVersion === 'cliproxy-v8-accounts') ||
      i.credentialState.configured)
  )
}
