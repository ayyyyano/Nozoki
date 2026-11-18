import type { Database } from '../types/database.ts'
import { readConfig } from './config.ts'
import { createConfigBackup } from '../../shared/domain/config-backup.ts'
import {
  backgroundImageHash,
  decodeBackgroundImage,
} from '../../shared/contracts/background-image.ts'
import { AuthError } from './auth-settings.ts'
import { DataLayerError } from '../types/database.ts'
import { readStoredState } from '../repositories/config.ts'
import { credentialKeys } from './credential-keys.ts'
import { decryptCredential } from './credentials.ts'

export async function exportConfigBackup(
  db: Database,
  options: { includeCredentials?: boolean } = {},
  env: Record<string, unknown> = {},
) {
  const state = await readStoredState(db)
  const config = state.config
  const credentials = new Map<string, { credentialPlain?: string; identityPlain?: string }>()
  if (
    options.includeCredentials &&
    state.integrations.some((i) => i.envelope || i.identityEnvelope)
  ) {
    try {
      const keys = await credentialKeys(env)
      for (const source of state.integrations) {
        const { id, provider, protocolVersion } = source.settings
        const entry: { credentialPlain?: string; identityPlain?: string } = {}
        if (source.envelope)
          entry.credentialPlain = await decryptCredential(id, provider, source.envelope, keys)
        if (
          source.identityEnvelope &&
          (provider !== 'cliproxy-bridge' || protocolVersion !== 'cliproxy-v8-accounts')
        )
          throw new Error('INVALID_IDENTITY_ENVELOPE')
        if (
          source.identityEnvelope &&
          provider === 'cliproxy-bridge' &&
          protocolVersion === 'cliproxy-v8-accounts'
        )
          entry.identityPlain = await decryptCredential(
            id,
            provider + ':identity',
            source.identityEnvelope,
            keys,
          )
        credentials.set(id, entry)
      }
    } catch {
      throw new AuthError(500, 'CREDENTIAL_DECRYPT_FAILED')
    }
  }
  let image: string | undefined
  if (config.site.background.source === 'uploaded') {
    const hash = config.site.background.url.slice('/api/background/'.length)
    const row = await db
      .prepare('SELECT data FROM site_background_images WHERE hash=?')
      .bind(hash)
      .first()
    if (!row?.data) throw new DataLayerError('CONFIG_BASELINE_INVALID')
    const bytes =
      row.data instanceof ArrayBuffer
        ? new Uint8Array(row.data)
        : new Uint8Array(row.data as number[])
    let raw = ''
    for (let i = 0; i < bytes.length; i += 8192)
      raw += String.fromCharCode(...bytes.subarray(i, i + 8192))
    image = btoa(raw)
    if (!decodeBackgroundImage(image) || (await backgroundImageHash(bytes)) !== hash)
      throw new DataLayerError('CONFIG_BASELINE_INVALID')
  }
  if ((await readConfig(db)).site.configVersion !== config.site.configVersion)
    throw new AuthError(409, 'CONFIG_CONFLICT')
  return createConfigBackup(config, image, undefined, credentials)
}
