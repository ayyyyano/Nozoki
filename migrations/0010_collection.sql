-- Collector fencing, source generations and exact balance observations. Local migration first.
ALTER TABLE integrations ADD COLUMN collection_revision INTEGER NOT NULL DEFAULT 1 CHECK(collection_revision>=1);
ALTER TABLE integrations ADD COLUMN collection_generation TEXT NOT NULL DEFAULT '';
UPDATE integrations SET collection_generation=lower(hex(randomblob(16)));
CREATE TRIGGER collection_integration_inserted AFTER INSERT ON integrations BEGIN UPDATE integrations SET collection_generation=lower(hex(randomblob(16))) WHERE id=NEW.id; END;
CREATE TRIGGER collection_integration_changed AFTER UPDATE ON integrations
WHEN NEW.provider IS NOT OLD.provider OR NEW.protocol_version IS NOT OLD.protocol_version
 OR NEW.base_url IS NOT OLD.base_url OR NEW.enabled IS NOT OLD.enabled OR NEW.refresh_interval IS NOT OLD.refresh_interval
 OR NEW.field_mappings_json IS NOT OLD.field_mappings_json OR NEW.capabilities_json IS NOT OLD.capabilities_json
 OR NEW.credential_ciphertext IS NOT OLD.credential_ciphertext OR NEW.credential_iv IS NOT OLD.credential_iv
 OR NEW.credential_key_version IS NOT OLD.credential_key_version OR NEW.credential_algorithm IS NOT OLD.credential_algorithm
 OR NEW.credential_updated_at IS NOT OLD.credential_updated_at
BEGIN UPDATE integrations SET collection_revision=OLD.collection_revision+1 WHERE id=NEW.id; END;
CREATE TRIGGER collection_modules_changed AFTER UPDATE ON dashboard_modules
WHEN NEW.enabled IS NOT OLD.enabled OR NEW.sources_json IS NOT OLD.sources_json
BEGIN
 UPDATE integrations SET collection_revision=collection_revision+1 WHERE id IN (
 SELECT json_extract(value,'$.sourceId') FROM json_each(OLD.sources_json)
 UNION SELECT json_extract(value,'$.sourceId') FROM json_each(NEW.sources_json));
END;
CREATE TRIGGER collection_modules_deleted AFTER DELETE ON dashboard_modules BEGIN
 UPDATE integrations SET collection_revision=collection_revision+1 WHERE id IN (SELECT json_extract(value,'$.sourceId') FROM json_each(OLD.sources_json));
END;
CREATE TRIGGER collection_modules_inserted AFTER INSERT ON dashboard_modules BEGIN
 UPDATE integrations SET collection_revision=collection_revision+1 WHERE id IN (SELECT json_extract(value,'$.sourceId') FROM json_each(NEW.sources_json));
END;
CREATE TABLE collector_environment (
 id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL CHECK(epoch>=1),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64), cleanup_after TEXT NOT NULL
) STRICT;
CREATE TABLE collection_state (
 source_id TEXT PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
 source_revision TEXT NOT NULL, environment_epoch INTEGER NOT NULL CHECK(environment_epoch>=1),
 next_run_at TEXT NOT NULL, retry_after_until TEXT,
 last_attempt_at TEXT, last_success_at TEXT, last_scheduled_at TEXT,
 failures INTEGER NOT NULL DEFAULT 0 CHECK(failures>=0),
 status TEXT NOT NULL DEFAULT 'unconfigured' CHECK(status IN ('ok','stale','error','unconfigured','unsupported','offline')),
 error_code TEXT,
 run_id TEXT, lease_owner TEXT, lease_token TEXT, lease_until TEXT,
 CHECK((run_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL)
 OR (run_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL))
) STRICT;
CREATE INDEX collection_state_due ON collection_state(next_run_at,source_id);
CREATE INDEX collection_state_lease ON collection_state(lease_until) WHERE lease_until IS NOT NULL;
ALTER TABLE collection_runs RENAME TO collection_runs_v1;
CREATE TABLE collection_runs (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
 config_version INTEGER NOT NULL CHECK(config_version>=1), status TEXT NOT NULL CHECK(status IN ('running','success','failure')),
 started_at TEXT NOT NULL, finished_at TEXT, error_code TEXT,
 source_revision TEXT, environment_epoch INTEGER, scheduled_at TEXT,
 metrics_json TEXT CHECK(metrics_json IS NULL OR (json_valid(metrics_json) AND json_type(metrics_json)='object'))
) STRICT;
INSERT INTO collection_runs(id,source_id,config_version,status,started_at,finished_at,error_code)
 SELECT id,source_id,config_version,status,started_at,finished_at,error_code FROM collection_runs_v1;
DROP TABLE collection_runs_v1;
CREATE INDEX collection_runs_started ON collection_runs(started_at);
CREATE INDEX collection_runs_source ON collection_runs(source_id,started_at);
ALTER TABLE integration_snapshot_views ADD COLUMN source_revision TEXT;
ALTER TABLE integration_snapshot_views ADD COLUMN environment_epoch INTEGER;
ALTER TABLE integration_snapshot_views ADD COLUMN order_at TEXT;
ALTER TABLE integration_snapshot_views ADD COLUMN collected_at TEXT;
-- Adopt the current generation without rewriting legacy snapshot JSON or its timestamps.
UPDATE integration_snapshot_views SET source_revision=(SELECT collection_generation||':'||collection_revision FROM integrations WHERE integrations.id=integration_snapshot_views.source_id);
CREATE TABLE balance_observations (
 source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE RESTRICT,
 series_revision TEXT NOT NULL, currency TEXT NOT NULL CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*'),
 observed_at TEXT, collected_at TEXT NOT NULL,
 total TEXT NOT NULL, granted TEXT NOT NULL, topped_up TEXT NOT NULL,
 PRIMARY KEY(source_id,series_revision,collected_at,currency)
) STRICT;
CREATE INDEX balance_observations_time ON balance_observations(collected_at);
CREATE TRIGGER collection_balance_history BEFORE DELETE ON integrations
WHEN EXISTS(SELECT 1 FROM balance_observations WHERE source_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'NOZOKI_SOURCE_HAS_HISTORY'); END;
CREATE TABLE collection_commit_guard (
 id INTEGER PRIMARY KEY CHECK(id=1),source_id TEXT NOT NULL, source_revision TEXT NOT NULL,
 environment_epoch INTEGER NOT NULL, fingerprint TEXT NOT NULL,
 run_id TEXT NOT NULL, lease_token TEXT NOT NULL, lease_owner TEXT NOT NULL, finished_at TEXT NOT NULL,
 views_json TEXT NOT NULL CHECK(json_valid(views_json) AND json_type(views_json)='array')
) STRICT;
CREATE TRIGGER collection_commit_fence BEFORE INSERT ON collection_commit_guard BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM integrations WHERE id=NEW.source_id AND enabled=1 AND (collection_generation||':'||collection_revision)=NEW.source_revision)
 THEN RAISE(ABORT,'SOURCE_CHANGED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM collector_environment WHERE id=1 AND epoch=NEW.environment_epoch AND fingerprint=NEW.fingerprint)
 THEN RAISE(ABORT,'ENVIRONMENT_CHANGED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM collection_state WHERE source_id=NEW.source_id AND source_revision=NEW.source_revision
 AND environment_epoch=NEW.environment_epoch AND run_id=NEW.run_id AND lease_token=NEW.lease_token AND lease_owner=NEW.lease_owner AND lease_until>NEW.finished_at AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND EXISTS(SELECT 1 FROM collection_runs r WHERE r.id=NEW.run_id AND r.source_id=NEW.source_id AND r.status='running' AND r.source_revision=NEW.source_revision AND r.environment_epoch=NEW.environment_epoch))
 THEN RAISE(ABORT,'LEASE_LOST') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.views_json) j JOIN integration_snapshot_views s
 ON s.source_id=NEW.source_id AND s.subject=json_extract(j.value,'$.subject') AND s.module_id=json_extract(j.value,'$.moduleId')
 WHERE coalesce(s.order_at,json_extract(s.snapshot_json,'$.observedAt'),json_extract(s.snapshot_json,'$.collectedAt'),s.updated_at)>json_extract(j.value,'$.orderAt')
 OR (coalesce(s.order_at,json_extract(s.snapshot_json,'$.observedAt'),json_extract(s.snapshot_json,'$.collectedAt'),s.updated_at)=json_extract(j.value,'$.orderAt')
 AND coalesce(s.collected_at,json_extract(s.snapshot_json,'$.collectedAt'),s.updated_at)>=json_extract(j.value,'$.collectedAt')))
 THEN RAISE(ABORT,'RESULT_OLDER') END;
END;
CREATE TRIGGER collector_environment_utc_insert BEFORE INSERT ON collector_environment BEGIN SELECT CASE WHEN (NEW.cleanup_after IS NOT NULL AND NOT coalesce(length(NEW.cleanup_after)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.cleanup_after,'+0 seconds')=NEW.cleanup_after,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collector_environment_utc_update BEFORE UPDATE ON collector_environment BEGIN SELECT CASE WHEN (NEW.cleanup_after IS NOT NULL AND NOT coalesce(length(NEW.cleanup_after)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.cleanup_after,'+0 seconds')=NEW.cleanup_after,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collection_state_utc_insert BEFORE INSERT ON collection_state BEGIN SELECT CASE WHEN (NEW.next_run_at IS NOT NULL AND NOT coalesce(length(NEW.next_run_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.next_run_at,'+0 seconds')=NEW.next_run_at,0)) OR (NEW.retry_after_until IS NOT NULL AND NOT coalesce(length(NEW.retry_after_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.retry_after_until,'+0 seconds')=NEW.retry_after_until,0)) OR (NEW.last_attempt_at IS NOT NULL AND NOT coalesce(length(NEW.last_attempt_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_attempt_at,'+0 seconds')=NEW.last_attempt_at,0)) OR (NEW.last_success_at IS NOT NULL AND NOT coalesce(length(NEW.last_success_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_success_at,'+0 seconds')=NEW.last_success_at,0)) OR (NEW.last_scheduled_at IS NOT NULL AND NOT coalesce(length(NEW.last_scheduled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_scheduled_at,'+0 seconds')=NEW.last_scheduled_at,0)) OR (NEW.lease_until IS NOT NULL AND NOT coalesce(length(NEW.lease_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.lease_until,'+0 seconds')=NEW.lease_until,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collection_state_utc_update BEFORE UPDATE ON collection_state BEGIN SELECT CASE WHEN (NEW.next_run_at IS NOT NULL AND NOT coalesce(length(NEW.next_run_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.next_run_at,'+0 seconds')=NEW.next_run_at,0)) OR (NEW.retry_after_until IS NOT NULL AND NOT coalesce(length(NEW.retry_after_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.retry_after_until,'+0 seconds')=NEW.retry_after_until,0)) OR (NEW.last_attempt_at IS NOT NULL AND NOT coalesce(length(NEW.last_attempt_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_attempt_at,'+0 seconds')=NEW.last_attempt_at,0)) OR (NEW.last_success_at IS NOT NULL AND NOT coalesce(length(NEW.last_success_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_success_at,'+0 seconds')=NEW.last_success_at,0)) OR (NEW.last_scheduled_at IS NOT NULL AND NOT coalesce(length(NEW.last_scheduled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_scheduled_at,'+0 seconds')=NEW.last_scheduled_at,0)) OR (NEW.lease_until IS NOT NULL AND NOT coalesce(length(NEW.lease_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.lease_until,'+0 seconds')=NEW.lease_until,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collection_runs_utc_insert BEFORE INSERT ON collection_runs BEGIN SELECT CASE WHEN (NEW.started_at IS NOT NULL AND NOT coalesce(length(NEW.started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.started_at,'+0 seconds')=NEW.started_at,0)) OR (NEW.finished_at IS NOT NULL AND NOT coalesce(length(NEW.finished_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.finished_at,'+0 seconds')=NEW.finished_at,0)) OR (NEW.scheduled_at IS NOT NULL AND NOT coalesce(length(NEW.scheduled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.scheduled_at,'+0 seconds')=NEW.scheduled_at,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collection_runs_utc_update BEFORE UPDATE ON collection_runs BEGIN SELECT CASE WHEN (NEW.started_at IS NOT NULL AND NOT coalesce(length(NEW.started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.started_at,'+0 seconds')=NEW.started_at,0)) OR (NEW.finished_at IS NOT NULL AND NOT coalesce(length(NEW.finished_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.finished_at,'+0 seconds')=NEW.finished_at,0)) OR (NEW.scheduled_at IS NOT NULL AND NOT coalesce(length(NEW.scheduled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.scheduled_at,'+0 seconds')=NEW.scheduled_at,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER balance_observations_utc_insert BEFORE INSERT ON balance_observations BEGIN SELECT CASE WHEN (NEW.observed_at IS NOT NULL AND NOT coalesce(length(NEW.observed_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.observed_at,'+0 seconds')=NEW.observed_at,0)) OR (NEW.collected_at IS NOT NULL AND NOT coalesce(length(NEW.collected_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.collected_at,'+0 seconds')=NEW.collected_at,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER balance_observations_utc_update BEFORE UPDATE ON balance_observations BEGIN SELECT CASE WHEN (NEW.observed_at IS NOT NULL AND NOT coalesce(length(NEW.observed_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.observed_at,'+0 seconds')=NEW.observed_at,0)) OR (NEW.collected_at IS NOT NULL AND NOT coalesce(length(NEW.collected_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.collected_at,'+0 seconds')=NEW.collected_at,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collection_commit_guard_utc_insert BEFORE INSERT ON collection_commit_guard BEGIN SELECT CASE WHEN (NEW.finished_at IS NOT NULL AND NOT coalesce(length(NEW.finished_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.finished_at,'+0 seconds')=NEW.finished_at,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collection_commit_guard_utc_update BEFORE UPDATE ON collection_commit_guard BEGIN SELECT CASE WHEN (NEW.finished_at IS NOT NULL AND NOT coalesce(length(NEW.finished_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.finished_at,'+0 seconds')=NEW.finished_at,0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END; END;
CREATE TRIGGER collection_state_error_insert BEFORE INSERT ON collection_state WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
CREATE TRIGGER collection_state_error_update BEFORE UPDATE ON collection_state WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
CREATE TRIGGER collection_runs_error_insert BEFORE INSERT ON collection_runs WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
CREATE TRIGGER collection_runs_error_update BEFORE UPDATE ON collection_runs WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
CREATE TRIGGER collection_view_order_insert BEFORE INSERT ON integration_snapshot_views WHEN (NEW.order_at IS NOT NULL AND NOT coalesce(length(NEW.order_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.order_at,'+0 seconds')=NEW.order_at,0)) OR (NEW.collected_at IS NOT NULL AND NOT coalesce(length(NEW.collected_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.collected_at,'+0 seconds')=NEW.collected_at,0)) BEGIN SELECT RAISE(ABORT,'INVALID_UTC_TIMESTAMP'); END;
CREATE TRIGGER collection_view_order_update BEFORE UPDATE ON integration_snapshot_views WHEN (NEW.order_at IS NOT NULL AND NOT coalesce(length(NEW.order_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.order_at,'+0 seconds')=NEW.order_at,0)) OR (NEW.collected_at IS NOT NULL AND NOT coalesce(length(NEW.collected_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.collected_at,'+0 seconds')=NEW.collected_at,0)) BEGIN SELECT RAISE(ABORT,'INVALID_UTC_TIMESTAMP'); END;
