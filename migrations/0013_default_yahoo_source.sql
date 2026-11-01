-- Yahoo is the default quote source. Collection uses fixed, unauthenticated HTTPS endpoints.
-- Complete the initial seed before the first configuration save; customized entries stay untouched.
INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json)
VALUES('yahoo','quotes-custom','yahoo-chart-v8','https://query1.finance.yahoo.com/',1,300,'{}','{"quote":{"supported":true,"verified":false}}')
ON CONFLICT(id) DO NOTHING;

UPDATE quote_symbols SET provider='yahoo',id=json_array(market,symbol,'yahoo')
WHERE market='US' AND symbol IN ('QQQM','VOO') AND provider IS NULL
  AND NOT EXISTS(SELECT 1 FROM quote_symbols q WHERE q.market=quote_symbols.market AND q.symbol=quote_symbols.symbol AND q.provider='yahoo')
  AND EXISTS(SELECT 1 FROM integrations WHERE id='yahoo' AND provider='quotes-custom' AND protocol_version='yahoo-chart-v8' AND base_url='https://query1.finance.yahoo.com/')
  AND EXISTS(SELECT 1 FROM site_settings WHERE id=1 AND config_version=1 AND write_token IS NULL);
UPDATE dashboard_modules SET sources_json='{"main":{"sourceId":"yahoo","subject":"default"}}'
WHERE id='quotes' AND json(sources_json)='{}'
  AND EXISTS(SELECT 1 FROM integrations WHERE id='yahoo' AND provider='quotes-custom' AND protocol_version='yahoo-chart-v8' AND base_url='https://query1.finance.yahoo.com/')
  AND EXISTS(SELECT 1 FROM site_settings WHERE id=1 AND config_version=1 AND write_token IS NULL);
