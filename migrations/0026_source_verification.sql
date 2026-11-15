ALTER TABLE integrations ADD COLUMN verification_json TEXT
  CHECK (verification_json IS NULL OR json_valid(verification_json));
