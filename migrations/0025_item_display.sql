-- Keep the old presentation and Services order columns intact for deployed configurations.
ALTER TABLE dashboard_modules ADD COLUMN item_display_json TEXT DEFAULT NULL
  CHECK (item_display_json IS NULL OR (
    id IN ('devices','tailscale','services') AND length(item_display_json)<=490000
    AND json_valid(item_display_json) AND json_type(item_display_json)='object'
  ));
