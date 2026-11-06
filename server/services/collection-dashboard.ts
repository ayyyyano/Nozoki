import type { StoredState } from '../repositories/config.ts'
import type { Database } from '../types/database.ts'
import { DataLayerError } from '../types/database.ts'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import type { ModuleId } from '../../shared/contracts/dashboard.ts'
import { quotaExpired, safeCollectionCode } from '../../shared/collection/policy.ts'
import { readDailyBalances, balanceSeries } from './balance-observations.ts'
import { hashToken } from './auth-crypto.ts'
/** Add collection failures to the last valid data; never replace data with invented empty values. */
export async function withCollectionState(
  db: Database,
  state: StoredState,
  now: Date,
): Promise<StoredState> {
  let rows: Record<string, unknown>[]
  try {
    rows = (
      await db
        .prepare(
          'SELECT s.*,e.epoch AS current_epoch,e.fingerprint AS current_fingerprint FROM collection_state s JOIN collector_environment e ON e.id=1',
        )
        .all()
    ).results
  } catch (e) {
    // Only an intact pre-0010 database may use the legacy reader. A damaged
    // collector schema must not silently disable revision filtering.
    if (
      e instanceof Error &&
      e.message.includes('no such table:') &&
      state.integrations.every((i) => i.revision === undefined)
    )
      return state
    throw new DataLayerError('DATABASE_ERROR')
  }
  const snapshots = state.snapshots.flatMap((row) => {
    const source = state.integrations.find((i) => i.settings.id === row.source_id),
      collection = rows.find((s) => s.source_id === row.source_id)
    if (row.source_revision != null && source?.revision !== row.source_revision) return []
    if (
      row.environment_epoch != null &&
      collection &&
      row.environment_epoch !== collection.current_epoch
    )
      return []
    const moduleId = row.module_id as ModuleId
    let parsed
    try {
      parsed = snapshotSchema(moduleId).safeParse(JSON.parse(row.snapshot_json as string))
    } catch {
      return [row]
    }
    if (!parsed.success) return [row]
    const snapshot = parsed.data
    if (moduleId === 'codex') {
      const data = snapshot.data as import('../../shared/contracts/dashboard.ts').CodexData | null
      for (const a of data?.quota?.accounts ?? [])
        for (const window of a.windows)
          if (quotaExpired(window, now.getTime())) window.status = 'stale'
    }
    if (
      collection &&
      collection.source_revision === source?.revision &&
      collection.environment_epoch === collection.current_epoch
    ) {
      const status = collection.status as 'error' | 'unconfigured' | 'unsupported' | 'ok'
      snapshot.collection = {
        status,
        errorCode: collection.error_code ? safeCollectionCode(collection.error_code) : null,
        lastAttemptAt: collection.last_attempt_at as string | null,
        nextRunAt: collection.next_run_at as string,
      }
      if (collection.error_code) {
        snapshot.status = status
        snapshot.errorCode = safeCollectionCode(collection.error_code)
      }
    }
    return [{ ...row, snapshot_json: JSON.stringify(snapshot) }]
  })
  for (const module of state.config.modules.filter((m) => m.enabled)) {
    for (const ref of Object.values(module.sources)) {
      if (
        snapshots.some(
          (s) =>
            s.source_id === ref.sourceId && s.module_id === module.id && s.subject === ref.subject,
        )
      )
        continue
      const source = state.integrations.find((i) => i.settings.id === ref.sourceId)
      const collection = rows.find(
        (s) =>
          s.source_id === ref.sourceId &&
          s.source_revision === source?.revision &&
          s.environment_epoch === s.current_epoch,
      )
      if (!source || !collection || !collection.error_code) continue
      const stub = {
        status: ['error', 'unconfigured', 'unsupported'].includes(String(collection.status))
          ? collection.status
          : 'error',
        data: null,
        sourceId: ref.sourceId,
        observedAt: null,
        collectedAt: null,
        lastSuccessAt: null,
        expiresAt: null,
        errorCode: safeCollectionCode(collection.error_code),
      }
      snapshots.push({
        source_id: ref.sourceId,
        subject: ref.subject,
        module_id: module.id,
        snapshot_json: JSON.stringify(stub),
      })
    }
  }
  for (const row of snapshots) {
    if (row.module_id !== 'deepseek') continue
    if (state.storageMode === 'read-only') continue
    const source = state.integrations.find((s) => s.settings.id === row.source_id)
    if (!source || typeof row.source_revision !== 'string') continue
    let parsed
    try {
      parsed = snapshotSchema('deepseek').safeParse(JSON.parse(String(row.snapshot_json)))
    } catch {
      continue
    }
    if (!parsed.success || !parsed.data.data) continue
    const data = parsed.data.data as import('../../shared/contracts/dashboard.ts').DeepSeekData
    const series = await balanceSeries(source.settings, source.envelope)
    const collection = rows.find((r) => r.source_id === row.source_id)
    const legacySeries = collection
      ? await hashToken(
          JSON.stringify([
            row.source_revision,
            row.environment_epoch,
            collection.current_fingerprint,
          ]),
        )
      : undefined
    data.dailyBalances = await readDailyBalances(
      db,
      String(row.source_id),
      series,
      state.config.site.timezone,
      now,
      legacySeries,
    )
    data.timezone = state.config.site.timezone
    row.snapshot_json = JSON.stringify(parsed.data)
  }
  return { ...state, snapshots }
}
