import { z } from 'zod'
import { importCredentialKey, type CredentialKeyRing } from './credentials.ts'
const Version = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)
const Encoded = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
/** Explicit retained-version Secret map; no process-global plaintext or CryptoKey cache. */
export async function credentialKeys(env: Record<string, unknown>): Promise<CredentialKeyRing> {
  let materials: Record<string, string> = {}
  try {
    if (env.INTEGRATION_DECRYPTION_KEYS !== undefined) {
      if (
        typeof env.INTEGRATION_DECRYPTION_KEYS !== 'string' ||
        env.INTEGRATION_DECRYPTION_KEYS.length > 4096
      )
        throw new Error()
      materials = z.record(Version, Encoded).parse(JSON.parse(env.INTEGRATION_DECRYPTION_KEYS))
    }
    const active = env.INTEGRATION_KEY_VERSION
    if (env.INTEGRATION_ENCRYPTION_KEY !== undefined) {
      const version = Version.parse(active),
        secret = Encoded.parse(env.INTEGRATION_ENCRYPTION_KEY)
      if (Object.hasOwn(materials, version) && materials[version] !== secret) throw new Error()
      Object.defineProperty(materials, version, {
        value: secret,
        enumerable: true,
        configurable: true,
      })
    }
    if (!Object.keys(materials).length || Object.keys(materials).length > 8) throw new Error()
    const keys: Record<string, CryptoKey> = Object.create(null)
    for (const [version, secret] of Object.entries(materials)) {
      const bytes = Uint8Array.from(
        atob(secret.replaceAll('-', '+').replaceAll('_', '/') + '='),
        (c) => c.charCodeAt(0),
      )
      keys[version] = (await importCredentialKey(version, bytes)).keys[version]!
    }
    return { activeVersion: typeof active === 'string' ? active : 'read-only', keys }
  } catch {
    throw new Error('CREDENTIAL_KEY_UNAVAILABLE')
  }
}
