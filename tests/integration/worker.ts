// RPC-only integration harness. Never imported by Nuxt or listed in a deployment config.
import { WorkerEntrypoint } from 'cloudflare:workers'
import { saveConfig } from '../../server/services/config.ts'
import {
  encryptCredential,
  decryptCredential,
  importCredentialKey,
} from '../../server/services/credentials.ts'
import type { Database } from '../../server/types/database.ts'
export default class IntegrationHarness extends WorkerEntrypoint<{ DB: Database }> {
  fetch() {
    return new Response('Not an HTTP test API', { status: 404 })
  }
  async save(value: unknown) {
    return JSON.stringify(
      await saveConfig(this.env.DB, value, { actor: { kind: 'system', id: 'workerd-rpc-test' } }),
    )
  }
  async cryptoProbe() {
    const keys = await importCredentialKey('worker-v1', crypto.getRandomValues(new Uint8Array(32)))
    const value = crypto.randomUUID(),
      record = await encryptCredential('fixture', 'sleepy', value, keys, new Date().toISOString())
    const roundtrip = (await decryptCredential('fixture', 'sleepy', record, keys)) === value
    let authenticated = false
    try {
      await decryptCredential('wrong-source', 'sleepy', record, keys)
    } catch {
      authenticated = true
    }
    const denied = async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        return false
      } catch {
        return true
      }
    }
    const providerBound = await denied(() => decryptCredential('fixture', 'deepseek', record, keys))
    const versionBound = await denied(() =>
      decryptCredential(
        'fixture',
        'sleepy',
        { ...record, keyVersion: 'alias' },
        { activeVersion: 'alias', keys: { alias: keys.keys['worker-v1']! } },
      ),
    )
    const forged = await encryptCredential('fixture', 'deepseek', value, keys, record.updatedAt)
    const aadAuthenticated = await denied(() =>
      decryptCredential('fixture', 'sleepy', forged, keys),
    )
    // Frozen AES-GCM v1 vector produced independently with Node's native crypto.
    // Its public synthetic key is 00..1f; IV 00..0b. Never use test vectors as real keys.
    const legacyKeys = await importCredentialKey(
      'legacy-v1',
      Uint8Array.from({ length: 32 }, (_, i) => i),
    )
    const legacyRoundtrip =
      (await decryptCredential(
        'legacy-source',
        'sleepy',
        {
          algorithm: 'AES-GCM',
          keyVersion: 'legacy-v1',
          updatedAt: '2026-10-26T10:00:00.000Z',
          iv: 'AAECAwQFBgcICQoL',
          ciphertext: 'FFuYT42gllLOHsG67qo3INOX024+JurOBFlJu/vkAKPUzWg=',
        },
        legacyKeys,
      )) === 'SYNTHETIC_V1_COMPAT'
    return JSON.stringify({
      roundtrip,
      authenticated,
      providerBound,
      versionBound,
      aadAuthenticated,
      legacyRoundtrip,
      algorithm: record.algorithm,
      keyVersion: record.keyVersion,
    })
  }
}
