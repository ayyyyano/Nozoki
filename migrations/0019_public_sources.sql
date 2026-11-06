-- Preserve source identities, encrypted credentials, references and observations.
-- Only exact former built-ins have equivalent authorization and can migrate automatically.
CREATE TABLE source_access_migrations (
 source_id TEXT PRIMARY KEY,
 previous_access_json TEXT NOT NULL CHECK(json_valid(previous_access_json)),
 previous_source_revision TEXT NOT NULL,
 target_access_json TEXT CHECK(target_access_json IS NULL OR json_valid(target_access_json)),
 status TEXT NOT NULL CHECK(status IN ('migrated','review')),
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
INSERT INTO source_access_migrations
 SELECT id,access_json,collection_generation||':'||collection_revision,NULL,'review',
 'Administrator must confirm public target and credentials',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM integrations WHERE json_extract(access_json,'$.mode') IN ('legacy','private');
UPDATE source_access_migrations SET target_access_json=(
 SELECT json_object('mode','public','approved',json('true'),'approvedTarget',json_array(i.id,i.provider,i.protocol_version,'public',
 CASE i.provider WHEN 'deepseek' THEN 'bearer' WHEN 'tailscale' THEN 'tailscale-oauth' ELSE 'none' END,i.base_url)||'',
 'authentication',CASE i.provider WHEN 'deepseek' THEN 'bearer' WHEN 'tailscale' THEN 'tailscale-oauth' ELSE 'none' END)
 FROM integrations i WHERE i.id=source_id AND json_extract(i.access_json,'$.mode')='legacy' AND (
 (i.provider='deepseek' AND i.protocol_version='deepseek-balance-v1' AND i.base_url='https://api.deepseek.com/') OR
 (i.provider='tailscale' AND i.protocol_version='tailscale-devices-v2' AND i.base_url='https://api.tailscale.com/') OR
 (i.provider='quotes-custom' AND i.protocol_version='tencent-us-v1' AND i.base_url='https://web.ifzq.gtimg.cn/') OR
 (i.provider='quotes-custom' AND i.protocol_version='yahoo-chart-v8' AND i.base_url IN ('https://query1.finance.yahoo.com/','https://query2.finance.yahoo.com/'))));
UPDATE source_access_migrations SET status='migrated',reason='Equivalent exact official target'
 WHERE target_access_json IS NOT NULL;
INSERT INTO config_write_guard(id,token,expected_version)
 SELECT 1,'migration-0019',config_version FROM site_settings
 WHERE id=1 AND EXISTS(SELECT 1 FROM source_access_migrations WHERE status='migrated');
UPDATE integrations SET access_json=(SELECT target_access_json FROM source_access_migrations WHERE source_id=integrations.id)
 WHERE id IN (SELECT source_id FROM source_access_migrations WHERE status='migrated');
-- Carry forward only snapshots at the exact previous revision of an equivalent target.
-- Never rewrite payloads, observation times, backoff or historical run records.
UPDATE integration_snapshot_views SET source_revision=(SELECT collection_generation||':'||collection_revision FROM integrations WHERE id=source_id)
 WHERE EXISTS(SELECT 1 FROM source_access_migrations m WHERE m.source_id=integration_snapshot_views.source_id
 AND m.status='migrated' AND m.previous_source_revision=integration_snapshot_views.source_revision);
UPDATE collection_state SET source_revision=(SELECT collection_generation||':'||collection_revision FROM integrations WHERE id=source_id),
 run_id=NULL,lease_owner=NULL,lease_token=NULL,lease_until=NULL
 WHERE EXISTS(SELECT 1 FROM source_access_migrations m WHERE m.source_id=collection_state.source_id
 AND m.status='migrated' AND m.previous_source_revision=collection_state.source_revision);
UPDATE site_settings SET config_version=config_version+1,write_token='migration-0019',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=1 AND EXISTS(SELECT 1 FROM config_write_guard WHERE token='migration-0019');
INSERT INTO integration_audit(id,operation,config_version,changed_fields_json,actor_kind,actor_id,result,created_at)
 SELECT 'migration-0019-public-sources','config_save',config_version,'["integrations.access"]','system','migration-0019','success',updated_at
 FROM site_settings WHERE id=1 AND EXISTS(SELECT 1 FROM config_write_guard WHERE token='migration-0019');
DELETE FROM config_write_guard WHERE id=1 AND token='migration-0019';
