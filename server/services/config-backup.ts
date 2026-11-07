import type { Database } from '../types/database.ts'
import { readConfig } from './config.ts'
import { createConfigBackup } from '../../shared/domain/config-backup.ts'
import {
  backgroundImageHash,
  decodeBackgroundImage,
} from '../../shared/contracts/background-image.ts'
import { AuthError } from './auth-settings.ts'
import { DataLayerError } from '../types/database.ts'

export async function exportConfigBackup(db: Database) {
  const config = await readConfig(db)
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
  return createConfigBackup(config, image)
}
