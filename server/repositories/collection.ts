import type { Database, D1Statement } from '../types/database.ts'
import { hashToken } from '../services/auth-crypto.ts'
import type { CollectionPlan } from '../collection/plans.ts'
import type { CollectionEnvironment } from '../collection/environment.ts'
import { nextBalanceCollection } from '../../shared/domain/daily-balances.ts'
import { balanceSeries } from '../services/balance-observations.ts'
import {
  COLLECTION_BUDGET,
  failureStatus,
  retryPlan,
  successfulSchedule,
  type CollectionCode,
} from '../../shared/collection/policy.ts'

export interface CollectionState {
  source_id: string
  source_revision: string
  environment_epoch: number
  next_run_at: string
  retry_after_until: string | null
  failures: number
  run_id: string | null
  lease_until: string | null
  last_scheduled_at: string | null
}
export interface CollectionClaim {
  plan: CollectionPlan
  environment: CollectionEnvironment
  runId: string
  token: string
  owner: string
  startedAt: string
  scheduledAt: string
  prior: CollectionState
}
export async function syncCollectionPlans(
  db: Database,
  plans: CollectionPlan[],
  environment: CollectionEnvironment,
  now: string,
) {
  if (!plans.length) return
  await db.batch(
    plans.map((p) =>
      db
        .prepare(
          `INSERT INTO collection_state(source_id,source_revision,environment_epoch,next_run_at)
 SELECT id,?,?,? FROM integrations WHERE id=? AND (collection_generation||':'||collection_revision)=? AND enabled=1
 AND EXISTS(SELECT 1 FROM collector_environment WHERE id=1 AND epoch=? AND fingerprint=?)
 ON CONFLICT(source_id) DO UPDATE SET source_revision=excluded.source_revision,environment_epoch=excluded.environment_epoch,
 next_run_at=max(excluded.next_run_at,coalesce(collection_state.retry_after_until,excluded.next_run_at),
 CASE WHEN collection_state.status='error' THEN collection_state.next_run_at ELSE excluded.next_run_at END),
 failures=CASE WHEN collection_state.status='error' THEN collection_state.failures ELSE 0 END,
 status=CASE WHEN collection_state.status='error' THEN 'error' ELSE 'unconfigured' END,
 error_code=CASE WHEN collection_state.status='error' THEN collection_state.error_code ELSE NULL END,
 last_scheduled_at=NULL,last_success_at=NULL,
 run_id=NULL,lease_owner=NULL,lease_token=NULL,lease_until=NULL
 WHERE collection_state.source_revision<>excluded.source_revision OR collection_state.environment_epoch<>excluded.environment_epoch`,
        )
        .bind(
          p.revision,
          environment.epoch,
          now,
          p.source.id,
          p.revision,
          environment.epoch,
          environment.fingerprint,
        ),
    ),
  )
}
export async function dueCollectionStates(db: Database, now: string): Promise<CollectionState[]> {
  return (
    await db
      .prepare(
        `SELECT * FROM collection_state WHERE next_run_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_run_at,source_id LIMIT 100`,
      )
      .bind(now, now)
      .all()
  ).results as unknown as CollectionState[]
}
export async function claimCollection(
  db: Database,
  plan: CollectionPlan,
  environment: CollectionEnvironment,
  prior: CollectionState,
  now: string,
  scheduledAt: string,
  owner: string,
): Promise<CollectionClaim | null> {
  const runId = crypto.randomUUID(),
    token = crypto.randomUUID(),
    until = new Date(Date.parse(now) + COLLECTION_BUDGET.leaseMs).toISOString()
  const [_, claimed] = await db.batch([
    db
      .prepare(
        `UPDATE collection_runs SET status='failure',finished_at=?,error_code='LEASE_EXPIRED' WHERE source_id=? AND status='running' AND started_at<=?
 AND NOT EXISTS(SELECT 1 FROM collection_state s WHERE s.run_id=collection_runs.id AND s.lease_until>?)`,
      )
      .bind(
        now,
        plan.source.id,
        new Date(Date.parse(now) - COLLECTION_BUDGET.leaseMs).toISOString(),
        now,
      ),
    db
      .prepare(
        `UPDATE collection_state SET run_id=?,lease_token=?,lease_owner=?,lease_until=?,last_attempt_at=?,last_scheduled_at=?
 WHERE source_id=? AND source_revision=? AND environment_epoch=? AND next_run_at<=? AND (lease_until IS NULL OR lease_until<=?) AND (last_scheduled_at IS NULL OR last_scheduled_at<?)
 AND EXISTS(SELECT 1 FROM integrations WHERE id=? AND enabled=1 AND (collection_generation||':'||collection_revision)=?)
 AND EXISTS(SELECT 1 FROM collector_environment WHERE id=1 AND epoch=? AND fingerprint=?) RETURNING source_id`,
      )
      .bind(
        runId,
        token,
        owner,
        until,
        now,
        scheduledAt,
        plan.source.id,
        plan.revision,
        environment.epoch,
        now,
        now,
        scheduledAt,
        plan.source.id,
        plan.revision,
        environment.epoch,
        environment.fingerprint,
      ),
    db
      .prepare(
        `INSERT INTO collection_runs(id,source_id,config_version,status,started_at,source_revision,environment_epoch,scheduled_at)
 SELECT ?,?,?, 'running',?,?,?,? FROM collection_state WHERE source_id=? AND run_id=? AND lease_token=?`,
      )
      .bind(
        runId,
        plan.source.id,
        plan.configVersion,
        now,
        plan.revision,
        environment.epoch,
        scheduledAt,
        plan.source.id,
        runId,
        token,
      ),
  ])
  return claimed!.results.length
    ? { plan, environment, runId, token, owner, startedAt: now, scheduledAt, prior }
    : null
}
export interface ViewCommit {
  moduleId: string
  subject: string
  snapshot: unknown
  orderAt: string
  collectedAt: string
}
export interface BalanceCommit {
  currency: string
  observedAt: string | null
  collectedAt: string
  total: string
  granted: string
  toppedUp: string
}
export async function commitCollection(
  db: Database,
  c: CollectionClaim,
  views: ViewCommit[],
  balances: BalanceCommit[],
  now: string,
  metrics: Record<string, unknown>,
) {
  const json = JSON.stringify(views),
    series = await hashToken(
      JSON.stringify([c.plan.revision, c.environment.epoch, c.environment.fingerprint]),
    ),
    accountSeries = balances.length ? await balanceSeries(c.plan.source, c.plan.envelope) : null
  const statements: D1Statement[] = [
    db
      .prepare(
        `INSERT INTO collection_commit_guard(id,source_id,source_revision,environment_epoch,fingerprint,run_id,lease_token,lease_owner,finished_at,views_json) VALUES(1,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        c.plan.source.id,
        c.plan.revision,
        c.environment.epoch,
        c.environment.fingerprint,
        c.runId,
        c.token,
        c.owner,
        now,
        json,
      ),
    db
      .prepare(
        `INSERT INTO integration_snapshots(source_id,subject,updated_at) SELECT ?,json_extract(value,'$.subject'),? FROM json_each(?) WHERE 1 GROUP BY json_extract(value,'$.subject')
 ON CONFLICT(source_id,subject) DO UPDATE SET updated_at=max(integration_snapshots.updated_at,excluded.updated_at)`,
      )
      .bind(c.plan.source.id, now, json),
    db
      .prepare(
        `INSERT INTO integration_snapshot_views(source_id,subject,module_id,snapshot_json,updated_at,source_revision,environment_epoch,order_at,collected_at)
 SELECT ?,json_extract(value,'$.subject'),json_extract(value,'$.moduleId'),json_extract(value,'$.snapshot'),?,?,?,json_extract(value,'$.orderAt'),json_extract(value,'$.collectedAt') FROM json_each(?) WHERE 1
 ON CONFLICT(source_id,subject,module_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at,source_revision=excluded.source_revision,environment_epoch=excluded.environment_epoch,order_at=excluded.order_at,collected_at=excluded.collected_at`,
      )
      .bind(c.plan.source.id, now, c.plan.revision, c.environment.epoch, json),
  ]
  if (balances.length)
    statements.push(
      db
        .prepare(
          `INSERT INTO balance_observations(source_id,series_revision,currency,observed_at,collected_at,total,granted,topped_up,account_series)
 SELECT ?,?,json_extract(value,'$.currency'),json_extract(value,'$.observedAt'),json_extract(value,'$.collectedAt'),json_extract(value,'$.total'),json_extract(value,'$.granted'),json_extract(value,'$.toppedUp'),? FROM json_each(?)`,
        )
        .bind(c.plan.source.id, series, accountSeries, JSON.stringify(balances)),
    )
  statements.push(
    db
      .prepare(
        `UPDATE collection_state SET status='ok',error_code=NULL,last_success_at=?,next_run_at=?,failures=0,retry_after_until=NULL,run_id=NULL,lease_token=NULL,lease_owner=NULL,lease_until=NULL WHERE source_id=?`,
      )
      .bind(
        now,
        c.plan.source.provider === 'deepseek'
          ? nextBalanceCollection(
              Date.parse(now),
              c.plan.source.refreshInterval,
              c.plan.timezone ?? 'UTC',
            )
          : successfulSchedule(Date.parse(now), c.plan.source.refreshInterval),
        c.plan.source.id,
      ),
    db
      .prepare(
        `UPDATE collection_runs SET status='success',finished_at=?,metrics_json=? WHERE id=? AND status='running'`,
      )
      .bind(now, JSON.stringify(metrics), c.runId),
    db.prepare('DELETE FROM collection_commit_guard WHERE id=1'),
  )
  await db.batch(statements)
}
export async function failCollection(
  db: Database,
  c: CollectionClaim,
  code: CollectionCode,
  now: string,
  retryAfter: number | undefined,
  metrics: Record<string, unknown>,
) {
  const retry = retryPlan(
    Date.parse(now),
    c.plan.source.refreshInterval,
    c.prior.failures + 1,
    code,
    retryAfter,
    c.prior.retry_after_until,
  )
  await db.batch([
    db
      .prepare(
        `UPDATE collection_state SET status=?,error_code=?,next_run_at=?,retry_after_until=?,failures=failures+1,run_id=NULL,lease_token=NULL,lease_owner=NULL,lease_until=NULL
 WHERE source_id=? AND run_id=? AND lease_token=? AND lease_owner=? AND source_revision=? AND environment_epoch=?`,
      )
      .bind(
        failureStatus(code),
        code,
        retry.nextRunAt,
        retry.retryAfterUntil,
        c.plan.source.id,
        c.runId,
        c.token,
        c.owner,
        c.plan.revision,
        c.environment.epoch,
      ),
    db
      .prepare(
        `UPDATE collection_runs SET status='failure',error_code=?,finished_at=?,metrics_json=? WHERE id=? AND status='running'`,
      )
      .bind(code, now, JSON.stringify(metrics), c.runId),
  ])
}
export async function cleanupCollection(db: Database, now: string) {
  const next = new Date(Date.parse(now) + COLLECTION_BUDGET.cleanupSeconds * 1000).toISOString()
  const claimed = await db
    .prepare(
      'UPDATE collector_environment SET cleanup_after=? WHERE id=1 AND cleanup_after<=? RETURNING id',
    )
    .bind(next, now)
    .all()
  if (!claimed.results.length) return false
  const runCutoff = new Date(Date.parse(now) - 14 * 86400000).toISOString(),
    balanceCutoff = new Date(Date.parse(now) - 400 * 86400000).toISOString()
  await db.batch([
    db
      .prepare(
        `UPDATE collection_runs SET status='failure',error_code='LEASE_EXPIRED',finished_at=? WHERE id IN(SELECT r.id FROM collection_runs r WHERE r.status='running' AND r.started_at<? AND NOT EXISTS(SELECT 1 FROM collection_state s WHERE s.run_id=r.id AND s.lease_until>?) LIMIT 100)`,
      )
      .bind(now, new Date(Date.parse(now) - COLLECTION_BUDGET.leaseMs).toISOString(), now),
    db
      .prepare(
        `DELETE FROM collection_runs WHERE id IN(SELECT id FROM collection_runs WHERE status<>'running' AND started_at<? LIMIT 100)`,
      )
      .bind(runCutoff),
    db
      .prepare(
        `DELETE FROM balance_observations WHERE rowid IN(SELECT rowid FROM balance_observations WHERE collected_at<? ORDER BY collected_at LIMIT 100)`,
      )
      .bind(balanceCutoff),
  ])
  return true
}
