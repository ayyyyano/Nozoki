-- Preserve every old audit row while extending its trusted actor vocabulary.
CREATE TABLE integration_audit_next (
 id TEXT PRIMARY KEY,
 operation TEXT NOT NULL CHECK(operation IN ('config_initialize','config_save','integration_change')),
 config_version INTEGER NOT NULL CHECK(config_version>=1),
 changed_fields_json TEXT NOT NULL CHECK(json_valid(changed_fields_json) AND json_type(changed_fields_json)='array'),
 actor_kind TEXT NOT NULL CHECK(actor_kind IN ('system','unattributed','admin')),
 actor_id TEXT,
 result TEXT NOT NULL CHECK(result IN ('success','failure')),
 created_at TEXT NOT NULL CHECK(coalesce(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+0 seconds')=created_at,0)),
 CHECK(actor_kind!='admin' OR (actor_id IS NOT NULL AND length(actor_id)=64 AND actor_id NOT GLOB '*[^a-f0-9]*'))
) STRICT;
INSERT INTO integration_audit_next SELECT * FROM integration_audit;
DROP TABLE integration_audit;
ALTER TABLE integration_audit_next RENAME TO integration_audit;
CREATE INDEX integration_audit_created ON integration_audit(created_at);
-- Request digests are keyed MACs, never bare hashes of credential-containing requests.
CREATE TABLE config_requests (
 scope TEXT NOT NULL CHECK(length(scope)=64 AND scope NOT GLOB '*[^a-f0-9]*'),
 request_key TEXT NOT NULL CHECK(length(request_key)=36),
 request_mac TEXT NOT NULL CHECK(length(request_mac)=64 AND request_mac NOT GLOB '*[^a-f0-9]*'),
 config_version INTEGER NOT NULL CHECK(config_version>=1),
 changed INTEGER NOT NULL CHECK(changed IN (0,1)),
 created_at TEXT NOT NULL CHECK(coalesce(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+0 seconds')=created_at,0)),
 expires_at TEXT NOT NULL CHECK(coalesce(length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at,'+0 seconds')=expires_at,0) AND expires_at>created_at),
 PRIMARY KEY(scope,request_key)
) STRICT;
CREATE INDEX config_requests_expiry ON config_requests(expires_at);
