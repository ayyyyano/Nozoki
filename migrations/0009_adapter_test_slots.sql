-- Bounded semaphore for explicit administrator connection tests, not a collector lease.
CREATE TABLE integration_test_slots (
 id INTEGER PRIMARY KEY CHECK(id IN (1,2)),
 request_token TEXT CHECK(request_token IS NULL OR (length(request_token)=36 AND request_token NOT GLOB '*[^a-f0-9-]*')),
 expires_at TEXT NOT NULL CHECK(coalesce(length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at,'+0 seconds')=expires_at,0))
) STRICT;
INSERT INTO integration_test_slots VALUES(1,NULL,'1970-01-01T00:00:00.000Z');
INSERT INTO integration_test_slots VALUES(2,NULL,'1970-01-01T00:00:00.000Z');
