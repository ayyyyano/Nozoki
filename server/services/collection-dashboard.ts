import type { StoredState } from '../repositories/config.ts'
import type { Database } from '../types/database.ts'
import { DataLayerError } from '../types/database.ts'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import type { ModuleId } from '../../shared/contracts/dashboard.ts'
import { quotaExpired, safeCollectionCode } from '../../shared/collection/policy.ts'
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
          'SELECT s.*,e.epoch AS current_epoch FROM collection_state s JOIN collector_environment e ON e.id=1',
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
  // No successful row yet: surface a safe collection state for the configured module.
  for (const m of state.config.modules) {
    const ref = m.sources.main,
      c = ref && rows.find((r) => r.source_id === ref.sourceId)
    if (
      !ref ||
      !c ||
      snapshots.some(
        (r) => r.source_id === ref.sourceId && r.subject === ref.subject && r.module_id === m.id,
      )
    )
      continue
    const source = state.integrations.find((i) => i.settings.id === ref.sourceId)
    if (
      c.source_revision !== source?.revision ||
      c.environment_epoch !== c.current_epoch ||
      !c.error_code
    )
      continue
    snapshots.push({
      source_id: ref.sourceId,
      subject: ref.subject,
      module_id: m.id,
      snapshot_json: JSON.stringify({
        status: c.status,
        data: null,
        sourceId: ref.sourceId,
        observedAt: null,
        collectedAt: null,
        lastSuccessAt: null,
        expiresAt: null,
        errorCode: safeCollectionCode(c.error_code),
      }),
    })
  }
  return { ...state, snapshots }
}
