import { z } from 'zod'
import type { Database } from '../types/database.ts'
// Conservative adjustable proposal, not an agreed permanent product policy. No Cron is installed.
export const RetentionSchema = z.strictObject({
  snapshotsDays: z.number().int().min(1).max(365),
  runsDays: z.number().int().min(1).max(365),
  auditDays: z.number().int().min(1).max(3650),
  usageDays: z.number().int().min(1).max(3650),
  importsDays: z.number().int().min(1).max(3650),
})
export const DEFAULT_RETENTION = {
  snapshotsDays: 30,
  runsDays: 14,
  auditDays: 90,
  usageDays: 400,
  importsDays: 400,
}
export async function cleanupRecords(db: Database, now: Date, policy: unknown = DEFAULT_RETENTION) {
  const p = RetentionSchema.parse(policy),
    iso = now.toISOString(),
    before = (days: number) => new Date(now.getTime() - days * 86400000).toISOString()
  const result = await db.batch([
    db
      .prepare(
        `DELETE FROM integration_snapshots WHERE updated_at<? AND NOT EXISTS(
        SELECT 1 FROM dashboard_modules m,json_each(m.sources_json) j WHERE m.enabled=1 AND json_extract(j.value,'$.sourceId')=integration_snapshots.source_id AND json_extract(j.value,'$.subject')=integration_snapshots.subject)`,
      )
      .bind(before(p.snapshotsDays)),
    db
      .prepare("DELETE FROM collection_runs WHERE started_at<? AND status<>'running'")
      .bind(before(p.runsDays)),
    db.prepare('DELETE FROM integration_audit WHERE created_at<?').bind(before(p.auditDays)),
    // UTC cutoff with a two-day margin cannot prematurely delete a local IANA calendar day.
    db.prepare('DELETE FROM daily_usage WHERE day<?').bind(before(p.usageDays + 2).slice(0, 10)),
    db
      .prepare(
        'DELETE FROM sessions WHERE expires_at<=? OR idle_expires_at<=? OR revoked_at IS NOT NULL',
      )
      .bind(iso, iso),
    db.prepare('DELETE FROM login_limits WHERE expires_at<=?').bind(iso),
    db.prepare('DELETE FROM config_requests WHERE expires_at<=?').bind(iso),
    db.prepare('DELETE FROM import_batches WHERE created_at<?').bind(before(p.importsDays)),
  ])
  return result.map((r) => r.meta.changes)
}
