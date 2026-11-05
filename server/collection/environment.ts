import type { Database } from '../types/database.ts'
import { canonical } from '../../shared/contracts/admin.ts'
import { hashToken } from '../services/auth-crypto.ts'
import { PUBLIC_SERVICES } from '../adapters/public-targets.ts'
export interface CollectionEnvironment {
  epoch: number
  fingerprint: string
}
function deployment(env: Record<string, unknown>) {
  if (env.CF_VERSION_METADATA === undefined) return null
  const value = env.CF_VERSION_METADATA as { id?: unknown; timestamp?: unknown }
  if (
    !value ||
    typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id) ||
    typeof value.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(value.timestamp))
  )
    throw new Error('DEPLOYMENT_METADATA_INVALID')
  return { id: value.id, at: new Date(value.timestamp).toISOString() }
}

/** A newer deployment may probe before its first scheduled collection establishes the epoch. */
export async function collectionEnvironmentMatches(db: Database, env: Record<string, unknown>) {
  const row = await db.prepare('SELECT * FROM collector_environment WHERE id=1').first()
  if (!row) return null
  const current = deployment(env)
  if (current) {
    if (row.deployment_id !== current.id)
      return !row.deployment_created_at || current.at > String(row.deployment_created_at)
    return row.fingerprint === (await environmentFingerprint(env))
  }
  return (
    row.epoch === Number(env.COLLECTOR_EPOCH) &&
    row.fingerprint === (await environmentFingerprint(env))
  )
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
  const relayBound =
    typeof (env.NOZOKI_PRIVATE_RELAY as { fetch?: unknown } | undefined)?.fetch === 'function'
  if (
    relayBound &&
    (typeof env.COLLECTOR_BINDING_REVISION !== 'string' ||
      !env.COLLECTOR_BINDING_REVISION ||
      env.COLLECTOR_BINDING_REVISION.length > 128)
  )
    throw new Error('COLLECTOR_BINDING_REVISION_REQUIRED')
  const current = deployment(env)
  if (current) {
    const fingerprint = await environmentFingerprint(env)
    const previous = await db
      .prepare('SELECT epoch,fingerprint,deployment_id FROM collector_environment WHERE id=1')
      .first()
    // A code deployment fences in-flight work while retaining snapshots from unchanged credentials and routes.
    const carrySnapshots =
      previous?.fingerprint === fingerprint && previous.deployment_id !== current.id
    const [result] = await db.batch([
      db
        .prepare(
          `INSERT INTO collector_environment(id,epoch,fingerprint,cleanup_after,deployment_id,deployment_created_at)
        VALUES(1,1,?,'1970-01-01T00:00:00.000Z',?,?)
        ON CONFLICT(id) DO UPDATE SET
          epoch=collector_environment.epoch+CASE WHEN collector_environment.deployment_id=excluded.deployment_id THEN 0 ELSE 1 END,
          fingerprint=excluded.fingerprint,deployment_id=excluded.deployment_id,deployment_created_at=excluded.deployment_created_at
        WHERE (collector_environment.deployment_id IS NULL OR excluded.deployment_created_at>collector_environment.deployment_created_at
          OR excluded.deployment_id=collector_environment.deployment_id)
          AND (excluded.deployment_id IS NOT collector_environment.deployment_id OR excluded.fingerprint=collector_environment.fingerprint)
        RETURNING epoch,fingerprint`,
        )
        .bind(fingerprint, current.id, current.at),
      db
        .prepare(
          `UPDATE integration_snapshot_views SET environment_epoch=(SELECT epoch FROM collector_environment WHERE id=1)
        WHERE environment_epoch IS NULL AND source_revision IS NOT NULL
          AND EXISTS(SELECT 1 FROM collector_environment WHERE id=1 AND deployment_id=? AND fingerprint=?)`,
        )
        .bind(current.id, fingerprint),
      ...(carrySnapshots
        ? [
            db
              .prepare(
                `UPDATE integration_snapshot_views SET environment_epoch=(SELECT epoch FROM collector_environment WHERE id=1)
        WHERE environment_epoch=? AND EXISTS(SELECT 1 FROM integrations i WHERE i.id=source_id
          AND (i.collection_generation||':'||i.collection_revision)=source_revision)
          AND EXISTS(SELECT 1 FROM collector_environment WHERE id=1 AND deployment_id=? AND fingerprint=?)`,
              )
              .bind(Number(previous!.epoch), current.id, fingerprint),
          ]
        : []),
    ])
    const row = result!.results[0]
    if (!row) throw new Error('ENVIRONMENT_CHANGED')
    return { epoch: Number(row.epoch), fingerprint }
  }
  const epoch = Number(env.COLLECTOR_EPOCH)
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('COLLECTOR_EPOCH_REQUIRED')
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
