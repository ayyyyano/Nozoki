-- Public background bytes live outside configuration JSON and dashboard responses.
CREATE TABLE site_background_images (
  hash TEXT PRIMARY KEY CHECK(length(hash)=64),
  data BLOB NOT NULL CHECK(length(data) BETWEEN 30 AND 524288)
);
