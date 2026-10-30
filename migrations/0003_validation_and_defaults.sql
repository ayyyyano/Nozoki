-- Only complete defaults on an untouched v1 baseline; saved settings are never replaced.
UPDATE dashboard_modules SET fields_json='{"presence":{"enabled":false,"visibility":"admin"},"music":{"enabled":false,"visibility":"admin"},"gaming":{"enabled":false,"visibility":"admin"}}'
WHERE id='activity' AND fields_json='{}' AND EXISTS(SELECT 1 FROM site_settings WHERE id=1 AND config_version=1 AND write_token IS NULL);
UPDATE site_settings SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND config_version=1 AND write_token IS NULL;
UPDATE integration_audit SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),actor_id='migration-0003'
WHERE id='initial-configuration-v1' AND EXISTS(SELECT 1 FROM site_settings WHERE id=1 AND config_version=1 AND write_token IS NULL);
CREATE TRIGGER daily_usage_valid_insert BEFORE INSERT ON daily_usage BEGIN
  SELECT CASE WHEN strftime('%Y-%m-%d',NEW.day) IS NULL OR strftime('%Y-%m-%d',NEW.day)!=NEW.day OR length(NEW.timezone)=0 THEN RAISE(ABORT,'INVALID_USAGE_DATE') END;
END;
CREATE TRIGGER daily_usage_valid_update BEFORE UPDATE ON daily_usage BEGIN
  SELECT CASE WHEN strftime('%Y-%m-%d',NEW.day) IS NULL OR strftime('%Y-%m-%d',NEW.day)!=NEW.day OR length(NEW.timezone)=0 THEN RAISE(ABORT,'INVALID_USAGE_DATE') END;
END;
CREATE TRIGGER sessions_valid_insert BEFORE INSERT ON sessions BEGIN
  SELECT CASE WHEN NEW.token_hash GLOB '*[^a-f0-9]*'
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at)!=NEW.created_at
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_seen_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_seen_at)!=NEW.last_seen_at
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at)!=NEW.expires_at
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.idle_expires_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.idle_expires_at)!=NEW.idle_expires_at
    OR (NEW.revoked_at IS NOT NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at)!=NEW.revoked_at))
    THEN RAISE(ABORT,'INVALID_SESSION_METADATA') END;
END;
CREATE TRIGGER sessions_valid_update BEFORE UPDATE ON sessions BEGIN
  SELECT CASE WHEN NEW.token_hash GLOB '*[^a-f0-9]*'
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_seen_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_seen_at)!=NEW.last_seen_at
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at)!=NEW.expires_at
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.idle_expires_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.idle_expires_at)!=NEW.idle_expires_at
    OR (NEW.revoked_at IS NOT NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.revoked_at)!=NEW.revoked_at))
    THEN RAISE(ABORT,'INVALID_SESSION_METADATA') END;
END;
CREATE TRIGGER integrations_valid_insert BEFORE INSERT ON integrations BEGIN
  SELECT CASE WHEN NEW.provider NOT IN ('deepseek','deepseek-spend','sleepy','cliproxy-bridge','uptime-kuma','uptimeflare','quotes-custom')
    OR length(NEW.protocol_version)=0 OR (NEW.credential_updated_at IS NOT NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at)!=NEW.credential_updated_at))
    THEN RAISE(ABORT,'INVALID_INTEGRATION_METADATA') END;
END;
CREATE TRIGGER integrations_valid_update BEFORE UPDATE ON integrations BEGIN
  SELECT CASE WHEN NEW.provider NOT IN ('deepseek','deepseek-spend','sleepy','cliproxy-bridge','uptime-kuma','uptimeflare','quotes-custom')
    OR length(NEW.protocol_version)=0 OR (NEW.credential_updated_at IS NOT NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at)!=NEW.credential_updated_at))
    THEN RAISE(ABORT,'INVALID_INTEGRATION_METADATA') END;
END;
