-- One source/subject collection can feed several independently typed module views.
-- Existing snapshots are copied verbatim, not reinterpreted as another module's DTO.
ALTER TABLE integration_snapshots RENAME TO integration_snapshots_v1;
CREATE TABLE integration_snapshots (
  source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_id,subject)
) STRICT;
CREATE TABLE integration_snapshot_views (
  source_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  module_id TEXT NOT NULL REFERENCES dashboard_modules(id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_id,subject,module_id),
  FOREIGN KEY(source_id,subject) REFERENCES integration_snapshots(source_id,subject) ON DELETE CASCADE
) STRICT;
INSERT INTO integration_snapshots(source_id,subject,updated_at)
SELECT source_id,subject,updated_at FROM integration_snapshots_v1;
INSERT INTO integration_snapshot_views(source_id,subject,module_id,snapshot_json,updated_at)
SELECT source_id,subject,module_id,snapshot_json,updated_at FROM integration_snapshots_v1;
DROP TABLE integration_snapshots_v1;
CREATE INDEX integration_snapshots_updated ON integration_snapshots(updated_at);
CREATE INDEX integration_snapshot_views_module ON integration_snapshot_views(module_id);
CREATE INDEX integration_snapshot_views_updated ON integration_snapshot_views(updated_at);
