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
  const modules = (await db.prepare('PRAGMA table_info(dashboard_modules)').all()).results
  if (
    storageMode(modules) !== 'ready' ||
    !['guest_blur', 'home_services_json', 'presentation_json', 'item_display_json'].every((name) =>
      modules.some((c) => c.name === name),
    )
  )
    throw new DataLayerError('MIGRATIONS_REQUIRED')
  const columns = (await db.prepare('PRAGMA table_info(integrations)').all()).results
  if (
    !columns.some((c) => c.name === 'access_json') ||
    !columns.some((c) => c.name === 'identity_envelope_json')
  )
    throw new DataLayerError('MIGRATIONS_REQUIRED')
  const environment = (await db.prepare('PRAGMA table_info(collector_environment)').all()).results
  if (
    !environment.some((c) => c.name === 'deployment_id') ||
    !environment.some((c) => c.name === 'deployment_created_at')
  )
    throw new DataLayerError('MIGRATIONS_REQUIRED')
}
