-- Finish the untouched initial seed only. Existing saved configurations use the normal admin CAS API.
-- No credentials, snapshots, runs or history are removed by this backfill.
CREATE TABLE tencent_seed_guard (id INTEGER PRIMARY KEY CHECK(id=1)) STRICT;
INSERT INTO tencent_seed_guard(id)
SELECT 1 WHERE EXISTS(SELECT 1 FROM site_settings WHERE id=1 AND config_version=1 AND write_token IS NULL)
  AND (SELECT count(*) FROM integrations)=1
  AND EXISTS(SELECT 1 FROM integrations WHERE id='yahoo' AND provider='quotes-custom'
    AND protocol_version='yahoo-chart-v8' AND base_url='https://query1.finance.yahoo.com/'
    AND enabled=1 AND refresh_interval=300 AND json(field_mappings_json)='{}'
    AND credential_ciphertext IS NULL)
  AND NOT EXISTS(SELECT 1 FROM integration_snapshots)
  AND NOT EXISTS(SELECT 1 FROM collection_runs)
  AND NOT EXISTS(SELECT 1 FROM collection_state)
  AND NOT EXISTS(SELECT 1 FROM daily_usage)
  AND NOT EXISTS(SELECT 1 FROM import_batches)
  AND NOT EXISTS(SELECT 1 FROM integration_audit WHERE operation='config_save');

INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json)
SELECT 'tencent','quotes-custom','tencent-us-v1','https://web.ifzq.gtimg.cn/',1,300,'{}','{"quote":{"supported":true,"verified":false}}'
WHERE EXISTS(SELECT 1 FROM tencent_seed_guard);

UPDATE quote_symbols SET provider='tencent',id=json_array(market,symbol,'tencent')
WHERE provider='yahoo' AND EXISTS(SELECT 1 FROM tencent_seed_guard);
UPDATE dashboard_modules SET sources_json=json_set(sources_json,'$.main.sourceId','tencent')
WHERE json_extract(sources_json,'$.main.sourceId')='yahoo' AND EXISTS(SELECT 1 FROM tencent_seed_guard);
DELETE FROM integrations WHERE id='yahoo' AND EXISTS(SELECT 1 FROM tencent_seed_guard);
DROP TABLE tencent_seed_guard;
