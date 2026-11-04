import type { Database } from '../types/database.ts'
import { canonical } from '../../shared/contracts/admin.ts'
import { hashToken } from '../services/auth-crypto.ts'
import { PUBLIC_SERVICES } from '../adapters/public-targets.ts'
export interface CollectionEnvironment {
  epoch: number
  fingerprint: string
}
export async function environmentFingerprint(env: Record<string, unknown>) {
  const keys = [
    'NOZOKI_PRIVATE_ROUTES',
    'NOZOKI_PRIVATE_RELAY_TOKEN',
    'INTEGRATION_ENCRYPTION_KEY',
    'INTEGRATION_KEY_VERSION',
    'INTEGRATION_DECRYPTION_KEYS',
    'COLLECTOR_BINDING_REVISION',
    'NOZOKI_PUBLIC_ROUTES',
  ]
  const values = await Promise.all(
    keys.map(async (k) => [
      k,
      await hashToken(typeof env[k] === 'string' ? (env[k] as string) : 'absent'),
    ]),
  )
  const fingerprint: Record<string, unknown> = {
    managedEgressPolicy: 'public-https-v2',
    values,
    publicServices: PUBLIC_SERVICES,
    relayBound: typeof (env.NOZOKI_PRIVATE_RELAY as { fetch?: unknown })?.fetch === 'function',
  }
  if (
    env.NOZOKI_CONNECTOR_TOKEN !== undefined ||
    env.NOZOKI_CONNECTOR_URL !== undefined ||
    env.NOZOKI_SOURCE_CONNECTOR !== undefined
  ) {
    fingerprint.connector = await Promise.all(
      ['NOZOKI_CONNECTOR_TOKEN', 'NOZOKI_CONNECTOR_URL', 'NOZOKI_CONNECTOR_REVISION'].map(
        async (k) => [
          k,
          await hashToken(typeof env[k] === 'string' ? (env[k] as string) : 'absent'),
        ],
      ),
    )
    fingerprint.connectorBound =
      typeof (env.NOZOKI_SOURCE_CONNECTOR as { fetch?: unknown })?.fetch === 'function'
  }
  return hashToken(canonical(fingerprint))
}
export async function collectionEnvironment(
  db: Database,
  env: Record<string, unknown>,
): Promise<CollectionEnvironment> {
  const epoch = Number(env.COLLECTOR_EPOCH)
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('COLLECTOR_EPOCH_REQUIRED')
  const relayBound =
    typeof (env.NOZOKI_PRIVATE_RELAY as { fetch?: unknown } | undefined)?.fetch === 'function'
  if (
    relayBound &&
    (typeof env.COLLECTOR_BINDING_REVISION !== 'string' ||
      !env.COLLECTOR_BINDING_REVISION ||
      env.COLLECTOR_BINDING_REVISION.length > 128)
  )
    throw new Error('COLLECTOR_BINDING_REVISION_REQUIRED')
  const fingerprint = await environmentFingerprint(env)
  const [r] = await db.batch([
    db
      .prepare(
        `INSERT INTO collector_environment(id,epoch,fingerprint,cleanup_after) VALUES(1,?,?,'1970-01-01T00:00:00.000Z')
  ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,fingerprint=excluded.fingerprint WHERE excluded.epoch>collector_environment.epoch RETURNING epoch,fingerprint`,
      )
      .bind(epoch, fingerprint),
    db
      .prepare(
        `UPDATE integration_snapshot_views SET environment_epoch=? WHERE environment_epoch IS NULL AND source_revision IS NOT NULL AND EXISTS(SELECT 1 FROM collector_environment WHERE id=1 AND epoch=? AND fingerprint=?)`,
      )
      .bind(epoch, epoch, fingerprint),
  ])
  if (!r!.results.length) {
    const old = await db
      .prepare('SELECT epoch,fingerprint FROM collector_environment WHERE id=1')
      .first()
    if (old?.epoch !== epoch || old.fingerprint !== fingerprint)
      throw new Error('ENVIRONMENT_CHANGED')
  }
  return { epoch, fingerprint }
}
