import { z } from 'zod'
import {
  DaySchema,
  DecimalSchema,
  IdSchema,
  ModuleIdSchema,
  TimezoneSchema,
  UtcSchema,
} from '../../shared/contracts/config.ts'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import type { Database } from '../types/database.ts'
import type { CollectionClaim } from './collection.ts'
import type { CodexData } from '../../shared/contracts/dashboard.ts'

export async function readPriorCodexQuota(db: Database, claim: CollectionClaim) {
  const row = await db
    .prepare(
      `SELECT snapshot_json FROM integration_snapshot_views
     WHERE source_id=? AND module_id='codex' AND source_revision=? AND environment_epoch=?
     ORDER BY collected_at DESC LIMIT 1`,
    )
    .bind(claim.plan.source.id, claim.plan.revision, claim.environment.epoch)
    .first<{ snapshot_json: string }>()
  if (!row) return []
  try {
    const parsed = snapshotSchema('codex').safeParse(JSON.parse(row.snapshot_json))
    if (parsed.success && parsed.data.sourceId === claim.plan.source.id)
      return (parsed.data.data as CodexData | null)?.quota?.accounts ?? []
  } catch {
    // A damaged cache must not block a new observation.
  }
  return []
}
export const SnapshotWriteSchema = z
  .strictObject({
    sourceId: IdSchema,
    subject: z.string().min(1).max(128),
    moduleId: ModuleIdSchema,
    snapshot: z.unknown(),
    updatedAt: UtcSchema,
  })
  .superRefine((v, ctx) => {
    const parsed = snapshotSchema(v.moduleId).safeParse(v.snapshot)
    if (!parsed.success || parsed.data.sourceId !== v.sourceId)
      ctx.addIssue({ code: 'custom', message: 'Invalid snapshot' })
  })
/** Legacy/import helper, not a collection write path. Scheduled reads must use
 * commitCollection so lease, source revision and view order are checked atomically. */
export async function upsertSnapshot(db: Database, value: unknown) {
  const v = SnapshotWriteSchema.parse(value)
  if (JSON.stringify(v.snapshot).length > 500000) throw new Error('SNAPSHOT_TOO_LARGE')
  return db.batch([
    db
      .prepare(
        `INSERT INTO integration_snapshots(source_id,subject,updated_at) VALUES(?,?,?)
      ON CONFLICT(source_id,subject) DO UPDATE SET updated_at=max(integration_snapshots.updated_at,excluded.updated_at)`,
      )
      .bind(v.sourceId, v.subject, v.updatedAt),
    db
      .prepare(
        `INSERT INTO integration_snapshot_views(source_id,subject,module_id,snapshot_json,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(source_id,subject,module_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at WHERE excluded.updated_at>=integration_snapshot_views.updated_at`,
      )
      .bind(v.sourceId, v.subject, v.moduleId, JSON.stringify(v.snapshot), v.updatedAt),
  ])
}
export const DailyUsageSchema = z.strictObject({
  sourceId: IdSchema,
  day: DaySchema,
  timezone: TimezoneSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  dimension: IdSchema,
  amount: DecimalSchema.refine((v) => !v.startsWith('-')),
  updatedAt: UtcSchema,
})
export async function upsertDailyUsage(db: Database, value: unknown) {
  const v = DailyUsageSchema.parse(value)
  return db
    .prepare(
      `INSERT INTO daily_usage(source_id,day,timezone,currency,dimension,amount,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(source_id,day,timezone,currency,dimension) DO UPDATE SET amount=excluded.amount,updated_at=excluded.updated_at WHERE excluded.updated_at>=daily_usage.updated_at`,
    )
    .bind(v.sourceId, v.day, v.timezone, v.currency, v.dimension, v.amount, v.updatedAt)
    .run()
}
