-- Removing a configured source must not silently cascade-delete daily/import history.
-- A later administrator workflow must explicitly archive or expire that history first.
CREATE TRIGGER integration_history_before_delete BEFORE DELETE ON integrations
WHEN EXISTS(SELECT 1 FROM daily_usage WHERE source_id=OLD.id)
  OR EXISTS(SELECT 1 FROM import_batches WHERE source_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'NOZOKI_SOURCE_HAS_HISTORY');
END;
