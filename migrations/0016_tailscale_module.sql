-- Add an independent disabled Tailscale module without replacing saved settings or snapshots.
PRAGMA defer_foreign_keys=ON;
DROP TRIGGER config_guard_before_insert;
DROP TRIGGER collection_modules_changed;
DROP TRIGGER collection_modules_deleted;
DROP TRIGGER collection_modules_inserted;
CREATE TABLE dashboard_modules_next (
 id TEXT PRIMARY KEY CHECK(id IN ('deepseek','devices','tailscale','codex','activity','quotes','links','services')),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 sort_order INTEGER NOT NULL CHECK(sort_order>=0),
 visibility TEXT NOT NULL CHECK(visibility IN ('public','admin')),
 guest_behavior TEXT NOT NULL CHECK(guest_behavior IN ('hidden','login_hint')),
 fields_json TEXT NOT NULL CHECK(json_valid(fields_json) AND json_type(fields_json)='object'),
 sources_json TEXT NOT NULL CHECK(json_valid(sources_json) AND json_type(sources_json)='object'),
 ip_visibility TEXT NOT NULL DEFAULT 'admin' CHECK(ip_visibility IN ('public','hidden','admin'))
) STRICT;
INSERT INTO dashboard_modules_next(id,enabled,title,sort_order,visibility,guest_behavior,fields_json,sources_json)
 SELECT id,enabled,title,sort_order,visibility,guest_behavior,fields_json,sources_json FROM dashboard_modules;
DROP TABLE dashboard_modules;
ALTER TABLE dashboard_modules_next RENAME TO dashboard_modules;
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

CREATE TRIGGER config_guard_before_insert BEFORE INSERT ON config_write_guard BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM site_settings)!=1 OR (SELECT count(*) FROM dashboard_modules)!=8
 THEN RAISE(ABORT,'NOZOKI_BASELINE_INVALID')
 WHEN (SELECT config_version FROM site_settings WHERE id=1)!=NEW.expected_version
 THEN RAISE(ABORT,'NOZOKI_CONFIG_CONFLICT') END;
END;
-- Rank once before updating, preserving the user's relative ordering including ties.
CREATE TABLE module_order_0016(id TEXT PRIMARY KEY, position INTEGER NOT NULL) STRICT;
INSERT INTO module_order_0016 SELECT id,row_number() OVER(ORDER BY sort_order,id)-1 FROM dashboard_modules;
UPDATE dashboard_modules SET sort_order=(SELECT position FROM module_order_0016 WHERE id=dashboard_modules.id)
 + CASE WHEN (SELECT position FROM module_order_0016 WHERE id=dashboard_modules.id)>(SELECT position FROM module_order_0016 WHERE id='devices') THEN 1 ELSE 0 END;
INSERT INTO dashboard_modules(id,enabled,title,sort_order,visibility,guest_behavior,fields_json,sources_json,ip_visibility)
 SELECT 'tailscale',0,'Tailscale',position+1,'admin','login_hint','{}','{}','admin' FROM module_order_0016 WHERE id='devices';
DROP TABLE module_order_0016;
DROP TRIGGER integrations_valid_insert;
DROP TRIGGER integrations_valid_update;
CREATE TRIGGER integrations_valid_insert BEFORE INSERT ON integrations BEGIN
  SELECT CASE WHEN NEW.provider NOT IN ('deepseek','deepseek-spend','sleepy','tailscale','cliproxy-bridge','uptime-kuma','uptimeflare','quotes-custom')
    OR length(NEW.protocol_version)=0 OR (NEW.credential_updated_at IS NOT NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at)!=NEW.credential_updated_at))
    THEN RAISE(ABORT,'INVALID_INTEGRATION_METADATA') END;
END;
CREATE TRIGGER integrations_valid_update BEFORE UPDATE ON integrations BEGIN
  SELECT CASE WHEN NEW.provider NOT IN ('deepseek','deepseek-spend','sleepy','tailscale','cliproxy-bridge','uptime-kuma','uptimeflare','quotes-custom')
    OR length(NEW.protocol_version)=0 OR (NEW.credential_updated_at IS NOT NULL AND (strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at) IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.credential_updated_at)!=NEW.credential_updated_at))
    THEN RAISE(ABORT,'INVALID_INTEGRATION_METADATA') END;
END;

INSERT INTO config_write_guard(id,token,expected_version) SELECT 1,'migration-0016',config_version FROM site_settings WHERE id=1;
UPDATE site_settings SET config_version=config_version+1,write_token='migration-0016',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
INSERT INTO integration_audit(id,operation,config_version,changed_fields_json,actor_kind,actor_id,result,created_at)
 SELECT 'migration-0016-tailscale','config_save',config_version,'["modules"]','system','migration-0016','success',updated_at FROM site_settings WHERE id=1;
DELETE FROM config_write_guard WHERE id=1 AND token='migration-0016';
PRAGMA defer_foreign_keys=OFF;
