ALTER TABLE dashboard_modules ADD COLUMN guest_blur INTEGER NOT NULL DEFAULT 0 CHECK(guest_blur IN (0,1));
ALTER TABLE balance_observations ADD COLUMN account_series TEXT;
CREATE INDEX balance_observations_account_time ON balance_observations(source_id,account_series,collected_at);
