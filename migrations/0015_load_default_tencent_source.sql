-- Add the default quote source to existing sites. The version guard rejects stale admin drafts.
CREATE TABLE tencent_default_load (id INTEGER PRIMARY KEY CHECK(id=1), expected_version INTEGER NOT NULL) STRICT;
INSERT INTO tencent_default_load(id,expected_version)
SELECT 1,config_version FROM site_settings WHERE id=1
  AND config_version<9007199254740990
  AND (SELECT count(*) FROM dashboard_modules)=7
  AND (SELECT count(*) FROM integrations)<10
  AND NOT EXISTS(SELECT 1 FROM integrations WHERE id='tencent')
  AND NOT EXISTS(SELECT 1 FROM integration_audit WHERE id='default-tencent-source-v1');

INSERT INTO config_write_guard(id,token,expected_version)
SELECT id,'default-tencent-source-v1',expected_version FROM tencent_default_load;
UPDATE site_settings SET config_version=config_version+1,write_token='default-tencent-source-v1',
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id=1 AND EXISTS(SELECT 1 FROM tencent_default_load);

INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json)
SELECT 'tencent','quotes-custom','tencent-us-v1','https://web.ifzq.gtimg.cn/',1,300,'{}','{"quote":{"supported":true,"verified":false}}'
WHERE EXISTS(SELECT 1 FROM tencent_default_load);

UPDATE quote_symbols SET provider='tencent',id=json_array(market,symbol,'tencent')
WHERE market='US' AND symbol IN ('QQQM','VOO')
  AND (provider IS NULL OR (provider='yahoo' AND EXISTS(
    SELECT 1 FROM integrations WHERE id='yahoo' AND provider='quotes-custom' AND protocol_version='yahoo-chart-v8'
      AND base_url IN ('https://query1.finance.yahoo.com/','https://query2.finance.yahoo.com/'))))
  AND NOT EXISTS(SELECT 1 FROM quote_symbols q WHERE q.market=quote_symbols.market AND q.symbol=quote_symbols.symbol AND q.provider='tencent')
  AND EXISTS(SELECT 1 FROM tencent_default_load);

UPDATE dashboard_modules SET sources_json=json_set(sources_json,'$.main.sourceId','tencent')
WHERE id='quotes' AND json_extract(sources_json,'$.main.sourceId')='yahoo'
  AND json_extract(sources_json,'$.main.subject')='default'
  AND EXISTS(SELECT 1 FROM integrations WHERE id='yahoo' AND provider='quotes-custom' AND protocol_version='yahoo-chart-v8'
    AND base_url IN ('https://query1.finance.yahoo.com/','https://query2.finance.yahoo.com/'))
  AND EXISTS(SELECT 1 FROM tencent_default_load);
UPDATE dashboard_modules SET sources_json='{"main":{"sourceId":"tencent","subject":"default"}}'
WHERE id='quotes' AND json(sources_json)='{}'
  AND EXISTS(SELECT 1 FROM quote_symbols WHERE provider='tencent' AND enabled=1)
  AND EXISTS(SELECT 1 FROM tencent_default_load);

-- Retain Yahoo's credentials, snapshots and retry state; shared or still-referenced sources stay enabled.
UPDATE integrations SET enabled=0 WHERE id='yahoo' AND provider='quotes-custom' AND protocol_version='yahoo-chart-v8'
  AND base_url IN ('https://query1.finance.yahoo.com/','https://query2.finance.yahoo.com/')
  AND NOT EXISTS(SELECT 1 FROM quote_symbols WHERE provider='yahoo' AND enabled=1)
  AND NOT EXISTS(SELECT 1 FROM dashboard_modules m,json_each(m.sources_json) r
    WHERE m.enabled=1 AND json_extract(r.value,'$.sourceId')='yahoo')
  AND EXISTS(SELECT 1 FROM tencent_default_load);

INSERT INTO integration_audit(id,operation,config_version,changed_fields_json,actor_kind,actor_id,result,created_at)
SELECT 'default-tencent-source-v1','integration_change',config_version,'["integrations","quotes","modules"]','system',NULL,'success',updated_at
FROM site_settings WHERE id=1 AND EXISTS(SELECT 1 FROM tencent_default_load);
DELETE FROM config_write_guard WHERE id=1 AND token='default-tencent-source-v1'
  AND EXISTS(SELECT 1 FROM tencent_default_load);
DROP TABLE tencent_default_load;
