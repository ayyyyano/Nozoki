-- Session identity binding is separate so legacy sessions cannot acquire an identity.
CREATE TABLE session_bindings (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  auth_fingerprint TEXT NOT NULL CHECK(length(auth_fingerprint)=64 AND auth_fingerprint NOT GLOB '*[^a-f0-9]*')
) STRICT;
CREATE TRIGGER sessions_order_insert BEFORE INSERT ON sessions BEGIN
  SELECT CASE WHEN NEW.expires_at<NEW.created_at OR NEW.idle_expires_at<NEW.created_at
    OR NEW.idle_expires_at>NEW.expires_at OR NEW.last_seen_at<NEW.created_at OR NEW.last_seen_at>NEW.expires_at
    OR (NEW.revoked_at IS NOT NULL AND NEW.revoked_at<NEW.created_at)
    THEN RAISE(ABORT,'INVALID_SESSION_WINDOW') END;
END;
CREATE TRIGGER sessions_order_update BEFORE UPDATE ON sessions BEGIN
  SELECT CASE WHEN NEW.expires_at<NEW.created_at OR NEW.idle_expires_at<NEW.created_at
    OR NEW.idle_expires_at>NEW.expires_at OR NEW.last_seen_at<NEW.created_at OR NEW.last_seen_at>NEW.expires_at
    OR (NEW.revoked_at IS NOT NULL AND NEW.revoked_at<NEW.created_at)
    THEN RAISE(ABORT,'INVALID_SESSION_WINDOW') END;
END;
CREATE TRIGGER login_limits_valid_insert BEFORE INSERT ON login_limits BEGIN
  SELECT CASE WHEN NEW.key_hash GLOB '*[^a-f0-9]*'
    OR NOT coalesce(length(NEW.window_started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.window_started_at,'+0 seconds')=NEW.window_started_at,0)
    OR NOT coalesce(length(NEW.expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at,'+0 seconds')=NEW.expires_at,0)
    OR NEW.expires_at<NEW.window_started_at
    OR (NEW.blocked_until IS NOT NULL AND (NOT coalesce(length(NEW.blocked_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.blocked_until,'+0 seconds')=NEW.blocked_until,0) OR NEW.blocked_until<NEW.window_started_at OR NEW.blocked_until>NEW.expires_at))
    THEN RAISE(ABORT,'INVALID_LOGIN_WINDOW') END;
END;
CREATE TRIGGER login_limits_valid_update BEFORE UPDATE ON login_limits BEGIN
  SELECT CASE WHEN NEW.key_hash GLOB '*[^a-f0-9]*'
    OR NOT coalesce(length(NEW.window_started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.window_started_at,'+0 seconds')=NEW.window_started_at,0)
    OR NOT coalesce(length(NEW.expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at,'+0 seconds')=NEW.expires_at,0)
    OR NEW.expires_at<NEW.window_started_at
    OR (NEW.blocked_until IS NOT NULL AND (NOT coalesce(length(NEW.blocked_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.blocked_until,'+0 seconds')=NEW.blocked_until,0) OR NEW.blocked_until<NEW.window_started_at OR NEW.blocked_until>NEW.expires_at))
    THEN RAISE(ABORT,'INVALID_LOGIN_WINDOW') END;
END;
-- Run validation on legacy limits without changing their contents; abort bad baselines.
UPDATE login_limits SET failures=failures;
