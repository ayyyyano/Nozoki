import { DataLayerError, type Database } from '../types/database.ts'
export function getDatabase(event: { context: object }): Database {
  const context = event.context as {
    nozokiNode?: { db?: Database }
    cloudflare?: { env?: { DB?: unknown } }
  }
  const db = (context.nozokiNode?.db ?? context.cloudflare?.env?.DB) as Database | undefined
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function')
    throw new DataLayerError('DB_BINDING_MISSING')
  return db
}
