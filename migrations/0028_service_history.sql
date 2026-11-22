-- Previously values below 300 were accepted but collected on the five-minute schedule.
-- Require a fresh choice before an existing source can enter the three-minute schedule.
UPDATE integrations SET refresh_interval=300 WHERE refresh_interval<300;
UPDATE quote_symbols SET refresh_interval=300 WHERE refresh_interval<300;

CREATE TABLE service_observations (
  source_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  environment_fingerprint TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  samples_json TEXT NOT NULL CHECK(json_valid(samples_json)),
  PRIMARY KEY(source_id,source_revision,environment_fingerprint,observed_at)
);
CREATE INDEX service_observations_retention ON service_observations(observed_at);

CREATE TABLE service_heartbeat_windows (
  source_id TEXT PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  environment_fingerprint TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  samples_json TEXT NOT NULL CHECK(json_valid(samples_json))
);
