-- Local-first D1 schema. UTC ISO timestamps; exact amounts are TEXT, never REAL.
CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config_version INTEGER NOT NULL CHECK (config_version >= 1 AND config_version < 9007199254740991),
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json) AND json_type(settings_json) = 'object'),
  links_json TEXT NOT NULL CHECK (json_valid(links_json) AND json_type(links_json) = 'array'),
  write_token TEXT,
  updated_at TEXT NOT NULL CHECK (datetime(updated_at) IS NOT NULL AND substr(updated_at,-1)='Z')
) STRICT;
CREATE TABLE config_write_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL UNIQUE,
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1)
) STRICT;
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  base_url TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  refresh_interval INTEGER NOT NULL CHECK (refresh_interval BETWEEN 60 AND 86400),
  field_mappings_json TEXT NOT NULL CHECK (json_valid(field_mappings_json) AND json_type(field_mappings_json)='object'),
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json) AND json_type(capabilities_json)='object'),
  credential_ciphertext TEXT, credential_iv TEXT, credential_key_version TEXT,
  credential_algorithm TEXT CHECK (credential_algorithm IS NULL OR credential_algorithm='AES-GCM'),
  credential_updated_at TEXT,
  CHECK ((credential_ciphertext IS NULL AND credential_iv IS NULL AND credential_key_version IS NULL AND credential_algorithm IS NULL AND credential_updated_at IS NULL)
      OR (credential_ciphertext IS NOT NULL AND credential_iv IS NOT NULL AND credential_key_version IS NOT NULL AND credential_algorithm IS NOT NULL AND credential_updated_at IS NOT NULL)),
  CHECK (enabled=0 OR base_url IS NOT NULL)
) STRICT;
CREATE TABLE dashboard_modules (
  id TEXT PRIMARY KEY CHECK (id IN ('deepseek','devices','codex','activity','quotes','links','services')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 10000),
  visibility TEXT NOT NULL CHECK(visibility IN ('public','admin')),
  guest_behavior TEXT NOT NULL CHECK(guest_behavior IN ('hidden','login_hint')),
  fields_json TEXT NOT NULL CHECK(json_valid(fields_json) AND json_type(fields_json)='object'),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json) AND json_type(sources_json)='object')
) STRICT;
CREATE TABLE quote_symbols (
  id TEXT PRIMARY KEY, market TEXT NOT NULL, symbol TEXT NOT NULL, display_name TEXT NOT NULL,
  provider TEXT, sort_order INTEGER NOT NULL CHECK(sort_order>=0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  refresh_interval INTEGER NOT NULL CHECK(refresh_interval BETWEEN 60 AND 86400)
) STRICT;
CREATE UNIQUE INDEX quote_symbols_key ON quote_symbols(market,symbol,coalesce(provider,''));
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64), auth_version INTEGER NOT NULL CHECK(auth_version>=1),
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, idle_expires_at TEXT NOT NULL, revoked_at TEXT,
  CHECK(datetime(created_at) IS NOT NULL AND substr(created_at,-1)='Z'),
  CHECK(datetime(last_seen_at) IS NOT NULL AND substr(last_seen_at,-1)='Z'),
  CHECK(datetime(expires_at) IS NOT NULL AND substr(expires_at,-1)='Z'),
  CHECK(datetime(idle_expires_at) IS NOT NULL AND substr(idle_expires_at,-1)='Z')
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_idle_expiry ON sessions(idle_expires_at);
CREATE INDEX sessions_revoked ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE TABLE login_limits (
  key_hash TEXT PRIMARY KEY CHECK(length(key_hash)=64), failures INTEGER NOT NULL CHECK(failures>=0),
  window_started_at TEXT NOT NULL, blocked_until TEXT, expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX login_limits_expiry ON login_limits(expires_at);
CREATE TABLE integration_audit (
  id TEXT PRIMARY KEY, operation TEXT NOT NULL CHECK(operation IN ('config_initialize','config_save','integration_change')),
  config_version INTEGER NOT NULL CHECK(config_version>=1),
  changed_fields_json TEXT NOT NULL CHECK(json_valid(changed_fields_json) AND json_type(changed_fields_json)='array'),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('system','unattributed')),
  actor_id TEXT, result TEXT NOT NULL CHECK(result IN ('success','failure')),
  created_at TEXT NOT NULL CHECK(datetime(created_at) IS NOT NULL AND substr(created_at,-1)='Z')
) STRICT;
CREATE INDEX integration_audit_created ON integration_audit(created_at);
CREATE TABLE integration_snapshots (
  source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE, subject TEXT NOT NULL,
  module_id TEXT NOT NULL REFERENCES dashboard_modules(id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
  updated_at TEXT NOT NULL CHECK(datetime(updated_at) IS NOT NULL AND substr(updated_at,-1)='Z'),
  PRIMARY KEY(source_id,subject)
) STRICT;
CREATE INDEX integration_snapshots_module ON integration_snapshots(module_id);
CREATE INDEX integration_snapshots_updated ON integration_snapshots(updated_at);
CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  config_version INTEGER NOT NULL CHECK(config_version>=1), status TEXT NOT NULL CHECK(status IN ('running','success','failure')),
  started_at TEXT NOT NULL, finished_at TEXT, error_code TEXT CHECK(error_code IS NULL OR error_code IN ('TIMEOUT','AUTH_REQUIRED','INVALID_RESPONSE','UPSTREAM_UNAVAILABLE')),
  CHECK(datetime(started_at) IS NOT NULL AND substr(started_at,-1)='Z')
) STRICT;
CREATE INDEX collection_runs_started ON collection_runs(started_at);
CREATE INDEX collection_runs_source ON collection_runs(source_id,started_at);
CREATE TABLE daily_usage (
  source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK(strftime('%Y-%m-%d',day)=day), timezone TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(length(currency)=3 AND currency NOT GLOB '*[^A-Z]*'),
  dimension TEXT NOT NULL, amount TEXT NOT NULL CHECK(
    typeof(amount)='text' AND length(amount) BETWEEN 1 AND 128 AND amount NOT GLOB '*[^0-9.]*'
    AND amount GLOB '[0-9]*' AND length(amount)-length(replace(amount,'.',''))<=1 AND substr(amount,-1)!='.'
    AND (substr(amount,1,1)!='0' OR length(amount)=1 OR substr(amount,2,1)='.')
  ),
  updated_at TEXT NOT NULL CHECK(datetime(updated_at) IS NOT NULL AND substr(updated_at,-1)='Z'),
  PRIMARY KEY(source_id,day,timezone,currency,dimension)
) STRICT;
CREATE INDEX daily_usage_day ON daily_usage(day);
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  digest TEXT NOT NULL CHECK(length(digest)=64), status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')),
  created_at TEXT NOT NULL CHECK(datetime(created_at) IS NOT NULL AND substr(created_at,-1)='Z'),
  UNIQUE(source_id,digest)
) STRICT;
CREATE INDEX import_batches_created ON import_batches(created_at);

-- A stale expected version must be a SQL error, never a successful zero-row update.
CREATE TRIGGER config_guard_before_insert BEFORE INSERT ON config_write_guard BEGIN
  SELECT CASE
    WHEN (SELECT count(*) FROM site_settings)!=1 OR (SELECT count(*) FROM dashboard_modules)!=7
      THEN RAISE(ABORT,'NOZOKI_BASELINE_INVALID')
    WHEN (SELECT config_version FROM site_settings WHERE id=1)!=NEW.expected_version
      THEN RAISE(ABORT,'NOZOKI_CONFIG_CONFLICT')
  END;
END;
CREATE TRIGGER site_version_before_update BEFORE UPDATE OF config_version ON site_settings BEGIN
  SELECT CASE WHEN NEW.config_version!=OLD.config_version+1 OR NOT EXISTS(
    SELECT 1 FROM config_write_guard WHERE id=1 AND token=NEW.write_token AND expected_version=OLD.config_version
  ) THEN RAISE(ABORT,'NOZOKI_CONFIG_CONFLICT') END;
END;
