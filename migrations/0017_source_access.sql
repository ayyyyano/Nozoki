-- Source-level authorization stays in the same CAS transaction as its configuration.
ALTER TABLE integrations ADD COLUMN access_json TEXT NOT NULL DEFAULT '{"mode":"legacy"}' CHECK(json_valid(access_json));
ALTER TABLE integrations ADD COLUMN identity_envelope_json TEXT CHECK(identity_envelope_json IS NULL OR json_valid(identity_envelope_json));
CREATE TRIGGER collection_access_changed AFTER UPDATE OF access_json,identity_envelope_json ON integrations
WHEN NEW.access_json IS NOT OLD.access_json OR NEW.identity_envelope_json IS NOT OLD.identity_envelope_json
BEGIN UPDATE integrations SET collection_revision=collection_revision+1 WHERE id=NEW.id; END;
-- Defense in depth for mixed-version readers: revoked or stale grants cannot claim or commit.
CREATE TRIGGER collection_access_claim BEFORE UPDATE OF lease_token ON collection_state
WHEN NEW.lease_token IS NOT NULL AND NEW.lease_token IS NOT OLD.lease_token AND EXISTS(
 SELECT 1 FROM integrations i WHERE i.id=NEW.source_id AND json_extract(i.access_json,'$.mode') IN ('public','private')
 AND (json_extract(i.access_json,'$.approved') IS NOT 1 OR json_extract(i.access_json,'$.approvedTarget') IS NOT
 json_array(i.id,i.provider,i.protocol_version,json_extract(i.access_json,'$.mode'),json_extract(i.access_json,'$.authentication'),i.base_url)))
BEGIN SELECT RAISE(ABORT,'SOURCE_CHANGED'); END;
CREATE TRIGGER collection_access_commit BEFORE INSERT ON collection_commit_guard
WHEN EXISTS(SELECT 1 FROM integrations i WHERE i.id=NEW.source_id AND json_extract(i.access_json,'$.mode') IN ('public','private')
 AND (json_extract(i.access_json,'$.approved') IS NOT 1 OR json_extract(i.access_json,'$.approvedTarget') IS NOT
 json_array(i.id,i.provider,i.protocol_version,json_extract(i.access_json,'$.mode'),json_extract(i.access_json,'$.authentication'),i.base_url)))
BEGIN SELECT RAISE(ABORT,'SOURCE_CHANGED'); END;

DROP TRIGGER collection_state_error_insert;
CREATE TRIGGER collection_state_error_insert BEFORE INSERT ON collection_state WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','ACCESS_NOT_APPROVED','CONNECTOR_UNAVAILABLE','DESTINATION_BLOCKED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
DROP TRIGGER collection_state_error_update;
CREATE TRIGGER collection_state_error_update BEFORE UPDATE ON collection_state WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','ACCESS_NOT_APPROVED','CONNECTOR_UNAVAILABLE','DESTINATION_BLOCKED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
DROP TRIGGER collection_runs_error_insert;
CREATE TRIGGER collection_runs_error_insert BEFORE INSERT ON collection_runs WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','ACCESS_NOT_APPROVED','CONNECTOR_UNAVAILABLE','DESTINATION_BLOCKED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
DROP TRIGGER collection_runs_error_update;
CREATE TRIGGER collection_runs_error_update BEFORE UPDATE ON collection_runs WHEN NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('NOT_CONFIGURED','SOURCE_DISABLED','UNSUPPORTED_PROTOCOL','TARGET_NOT_APPROVED','ACCESS_NOT_APPROVED','CONNECTOR_UNAVAILABLE','DESTINATION_BLOCKED','AUTH_REQUIRED','CREDENTIAL_UNAVAILABLE','CREDENTIAL_INVALID','TIMEOUT','ABORTED','REDIRECT_REJECTED','RATE_LIMITED','NOT_FOUND','UPSTREAM_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','REQUEST_BUDGET','SOURCE_CHANGED','LEASE_LOST','LEASE_EXPIRED','RESULT_OLDER','DATABASE_ERROR','ENVIRONMENT_CHANGED') BEGIN SELECT RAISE(ABORT,'INVALID_COLLECTION_CODE'); END;
