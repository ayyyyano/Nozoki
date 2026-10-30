-- Canonical UTC milliseconds on existing business timestamps. Never rewrite prior migrations.
-- Fail atomically on an invalid legacy value; require explicit repair, never silently alter its date.
CREATE TABLE utc_migration_guard(value TEXT) STRICT;
CREATE TRIGGER utc_migration_guard_insert BEFORE INSERT ON utc_migration_guard BEGIN
  SELECT CASE WHEN NOT coalesce((length(NEW.value)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.value,'+0 seconds')=NEW.value),0) THEN RAISE(ABORT,'INVALID_LEGACY_UTC_TIMESTAMP') END;
END;
INSERT INTO utc_migration_guard SELECT updated_at FROM site_settings;
INSERT INTO utc_migration_guard SELECT created_at FROM integration_audit;
INSERT INTO utc_migration_guard SELECT updated_at FROM integration_snapshots;
INSERT INTO utc_migration_guard SELECT updated_at FROM integration_snapshot_views;
INSERT INTO utc_migration_guard SELECT started_at FROM collection_runs;
INSERT INTO utc_migration_guard SELECT finished_at FROM collection_runs WHERE finished_at IS NOT NULL;
INSERT INTO utc_migration_guard SELECT updated_at FROM daily_usage;
INSERT INTO utc_migration_guard SELECT created_at FROM import_batches;
INSERT INTO utc_migration_guard SELECT created_at FROM sessions;
INSERT INTO utc_migration_guard SELECT last_seen_at FROM sessions;
INSERT INTO utc_migration_guard SELECT expires_at FROM sessions;
INSERT INTO utc_migration_guard SELECT idle_expires_at FROM sessions;
INSERT INTO utc_migration_guard SELECT revoked_at FROM sessions WHERE revoked_at IS NOT NULL;
INSERT INTO utc_migration_guard SELECT credential_updated_at FROM integrations WHERE credential_updated_at IS NOT NULL;
DROP TABLE utc_migration_guard;
CREATE TRIGGER site_settings_utc_insert BEFORE INSERT ON site_settings BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER site_settings_utc_update BEFORE UPDATE ON site_settings BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integration_audit_utc_insert BEFORE INSERT ON integration_audit BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+0 seconds')=NEW.created_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integration_audit_utc_update BEFORE UPDATE ON integration_audit BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+0 seconds')=NEW.created_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integration_snapshots_utc_insert BEFORE INSERT ON integration_snapshots BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integration_snapshots_utc_update BEFORE UPDATE ON integration_snapshots BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integration_snapshot_views_utc_insert BEFORE INSERT ON integration_snapshot_views BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integration_snapshot_views_utc_update BEFORE UPDATE ON integration_snapshot_views BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER collection_runs_utc_insert BEFORE INSERT ON collection_runs BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.started_at,'+0 seconds')=NEW.started_at),0))
    OR (NEW.finished_at IS NOT NULL AND NOT coalesce((length(NEW.finished_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.finished_at,'+0 seconds')=NEW.finished_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER collection_runs_utc_update BEFORE UPDATE ON collection_runs BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.started_at,'+0 seconds')=NEW.started_at),0))
    OR (NEW.finished_at IS NOT NULL AND NOT coalesce((length(NEW.finished_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.finished_at,'+0 seconds')=NEW.finished_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER daily_usage_utc_insert BEFORE INSERT ON daily_usage BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER daily_usage_utc_update BEFORE UPDATE ON daily_usage BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+0 seconds')=NEW.updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER import_batches_utc_insert BEFORE INSERT ON import_batches BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+0 seconds')=NEW.created_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER import_batches_utc_update BEFORE UPDATE ON import_batches BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+0 seconds')=NEW.created_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER sessions_utc_insert BEFORE INSERT ON sessions BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+0 seconds')=NEW.created_at),0))
    OR (NOT coalesce((length(NEW.last_seen_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_seen_at,'+0 seconds')=NEW.last_seen_at),0))
    OR (NOT coalesce((length(NEW.expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at,'+0 seconds')=NEW.expires_at),0))
    OR (NOT coalesce((length(NEW.idle_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.idle_expires_at,'+0 seconds')=NEW.idle_expires_at),0))
    OR (NEW.revoked_at IS NOT NULL AND NOT coalesce((length(NEW.revoked_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at,'+0 seconds')=NEW.revoked_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER sessions_utc_update BEFORE UPDATE ON sessions BEGIN
  SELECT CASE WHEN (NOT coalesce((length(NEW.created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+0 seconds')=NEW.created_at),0))
    OR (NOT coalesce((length(NEW.last_seen_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_seen_at,'+0 seconds')=NEW.last_seen_at),0))
    OR (NOT coalesce((length(NEW.expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at,'+0 seconds')=NEW.expires_at),0))
    OR (NOT coalesce((length(NEW.idle_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.idle_expires_at,'+0 seconds')=NEW.idle_expires_at),0))
    OR (NEW.revoked_at IS NOT NULL AND NOT coalesce((length(NEW.revoked_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at,'+0 seconds')=NEW.revoked_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integrations_utc_insert BEFORE INSERT ON integrations BEGIN
  SELECT CASE WHEN (NEW.credential_updated_at IS NOT NULL AND NOT coalesce((length(NEW.credential_updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at,'+0 seconds')=NEW.credential_updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;
CREATE TRIGGER integrations_utc_update BEFORE UPDATE ON integrations BEGIN
  SELECT CASE WHEN (NEW.credential_updated_at IS NOT NULL AND NOT coalesce((length(NEW.credential_updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at,'+0 seconds')=NEW.credential_updated_at),0)) THEN RAISE(ABORT,'INVALID_UTC_TIMESTAMP') END;
END;

