import { DataLayerError, type Database } from '../types/database.ts'

export type StorageMode = 'ready' | 'read-only'

/** Inspect the real schema, including databases imported without Wrangler's migration ledger. */
export function storageMode(columns: Record<string, unknown>[]): StorageMode {
  const names = new Set(columns.map((column) => column.name))
  if (
    ![
      'id',
      'enabled',
      'title',
      'sort_order',
      'visibility',
      'guest_behavior',
      'fields_json',
      'sources_json',
    ].every((name) => names.has(name))
  )
    throw new DataLayerError('CONFIG_BASELINE_INVALID')
  return names.has('ip_visibility') ? 'ready' : 'read-only'
}

export async function requireWritableStorage(db: Database): Promise<void> {
  if (
    storageMode((await db.prepare('PRAGMA table_info(dashboard_modules)').all()).results) !==
    'ready'
  )
    throw new DataLayerError('MIGRATIONS_REQUIRED')
  const columns = (await db.prepare('PRAGMA table_info(integrations)').all()).results
  if (
    !columns.some((c) => c.name === 'access_json') ||
    !columns.some((c) => c.name === 'identity_envelope_json')
  )
    throw new DataLayerError('MIGRATIONS_REQUIRED')
}
