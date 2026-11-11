-- NULL preserves presentation and privacy defaults for existing configurations.
ALTER TABLE dashboard_modules ADD COLUMN presentation_json TEXT DEFAULT NULL
  CHECK (presentation_json IS NULL OR (id IN ('codex','tailscale') AND length(presentation_json)<=2048 AND json_valid(presentation_json) AND json_type(presentation_json)='object'));
