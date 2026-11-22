import type { Database } from '../types/database.ts'
import type { CollectionClaim } from './collection.ts'
import {
  HISTORY_HOURS,
  HISTORY_SAMPLE_LIMIT,
  MonitorHistoryPointSchema,
  type MonitorHistoryPoint,
} from '../../shared/contracts/service-history.ts'

export type ServiceHistoryCommit =
  | { kind: 'observation'; at: string; samples: Record<string, MonitorHistoryPoint> }
  | { kind: 'heartbeat'; at: string; samples: Record<string, MonitorHistoryPoint[]> }

export function serviceHistoryStatement(
  db: Database,
  claim: CollectionClaim,
  history: ServiceHistoryCommit,
) {
  const data = JSON.stringify(history.samples)
  if (history.kind === 'heartbeat')
    return db
      .prepare(
        `INSERT INTO service_heartbeat_windows(source_id,source_revision,environment_fingerprint,collected_at,samples_json)
       VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET
         source_revision=excluded.source_revision,environment_fingerprint=excluded.environment_fingerprint,
         collected_at=excluded.collected_at,samples_json=excluded.samples_json
       WHERE source_revision<>excluded.source_revision OR environment_fingerprint<>excluded.environment_fingerprint
         OR samples_json<>excluded.samples_json`,
      )
      .bind(
        claim.plan.source.id,
        claim.plan.revision,
        claim.environment.fingerprint,
        history.at,
        data,
      )
  return db
    .prepare(
      `INSERT INTO service_observations(source_id,source_revision,environment_fingerprint,observed_at,samples_json)
     VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING`,
    )
    .bind(
      claim.plan.source.id,
      claim.plan.revision,
      claim.environment.fingerprint,
      history.at,
      data,
    )
}

export interface MonitorSampleQuery {
  sourceId: string
  revision: string
  configVersion: number
  monitorId: string
  kind: ServiceHistoryCommit['kind']
}

function monitorSamplesStatement(db: Database, input: MonitorSampleQuery, now: Date) {
  const { sourceId, revision, configVersion, monitorId, kind } = input
  if (kind === 'heartbeat')
    return db
      .prepare(
        `SELECT m.value AS points FROM service_heartbeat_windows s
       JOIN json_each(s.samples_json) m ON m.key=?
       WHERE s.source_id=? AND s.source_revision=?
         AND s.environment_fingerprint=(SELECT fingerprint FROM collector_environment WHERE id=1)
         AND (SELECT config_version FROM site_settings WHERE id=1)=?`,
      )
      .bind(monitorId, sourceId, revision, configVersion)
  const cutoff = new Date(now.getTime() - HISTORY_HOURS * 3600000).toISOString()
  const latest = new Date(now.getTime() + 60_000).toISOString()
  return db
    .prepare(
      `SELECT m.value AS point FROM (
       SELECT observed_at,samples_json FROM service_observations
       WHERE source_id=? AND source_revision=? AND environment_fingerprint=(SELECT fingerprint FROM collector_environment WHERE id=1)
         AND (SELECT config_version FROM site_settings WHERE id=1)=?
         AND observed_at>=? AND observed_at<=? ORDER BY observed_at DESC LIMIT ?
     ) s JOIN json_each(s.samples_json) m ON m.key=? ORDER BY s.observed_at`,
    )
    .bind(sourceId, revision, configVersion, cutoff, latest, HISTORY_SAMPLE_LIMIT, monitorId)
}

export async function readMonitorSamples(db: Database, queries: MonitorSampleQuery[], now: Date) {
  if (!queries.length) return []
  const samples = await db.batch<{ point?: string; points?: string }>(
    queries.map((query) => monitorSamplesStatement(db, query, now)),
  )
  return samples.map(({ results }, i) => {
    if (queries[i]!.kind === 'heartbeat') {
      const points = results[0]?.points
      return points ? MonitorHistoryPointSchema.array().max(100).parse(JSON.parse(points)) : []
    }
    return results.map((row) => MonitorHistoryPointSchema.parse(JSON.parse(row.point!)))
  })
}
