-- Zombie-run recovery scans must touch only genuinely running rows, not full source history.
CREATE INDEX collection_runs_running ON collection_runs(source_id,started_at) WHERE status='running';
