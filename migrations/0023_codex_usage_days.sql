-- Only daily aggregates are retained. Raw queue records and account identifiers are not stored.
CREATE TABLE codex_usage_days (
 source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE RESTRICT,
 day TEXT NOT NULL CHECK(length(day)=10 AND coalesce(date(day,'+0 days')=day,0)),
 input INTEGER NOT NULL CHECK(input BETWEEN 0 AND 9007199254740991),
 output INTEGER NOT NULL CHECK(output BETWEEN 0 AND 9007199254740991),
 reasoning INTEGER NOT NULL CHECK(reasoning BETWEEN 0 AND 9007199254740991),
 cached INTEGER NOT NULL CHECK(cached BETWEEN 0 AND 9007199254740991),
 total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 9007199254740991),
 requests INTEGER NOT NULL CHECK(requests BETWEEN 0 AND 9007199254740991),
 failed INTEGER NOT NULL CHECK(failed BETWEEN 0 AND requests),
 updated_at TEXT NOT NULL CHECK(length(updated_at)=24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+0 seconds')=updated_at,0)),
 PRIMARY KEY(source_id,day)
) STRICT;
CREATE INDEX codex_usage_days_day ON codex_usage_days(day);
CREATE TRIGGER codex_usage_source_insert BEFORE INSERT ON codex_usage_days
WHEN NOT EXISTS(SELECT 1 FROM integrations WHERE id=NEW.source_id AND provider='cliproxy-bridge' AND protocol_version='cliproxy-v8-accounts')
BEGIN SELECT RAISE(ABORT,'INVALID_CODEX_USAGE_SOURCE'); END;
CREATE TRIGGER codex_usage_source_update BEFORE UPDATE ON codex_usage_days
WHEN NOT EXISTS(SELECT 1 FROM integrations WHERE id=NEW.source_id AND provider='cliproxy-bridge' AND protocol_version='cliproxy-v8-accounts')
BEGIN SELECT RAISE(ABORT,'INVALID_CODEX_USAGE_SOURCE'); END;
CREATE TRIGGER codex_usage_history BEFORE DELETE ON integrations
WHEN EXISTS(SELECT 1 FROM codex_usage_days WHERE source_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'NOZOKI_SOURCE_HAS_HISTORY'); END;
