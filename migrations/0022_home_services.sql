-- Presentation selection only. NULL retains automatic ordering; [] means explicitly none.
ALTER TABLE dashboard_modules ADD COLUMN home_services_json TEXT DEFAULT NULL
  CHECK (home_services_json IS NULL OR (json_valid(home_services_json) AND json_type(home_services_json)='array' AND json_array_length(home_services_json)<=8));
