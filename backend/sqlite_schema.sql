-- Runtime schema. Initial creation and JSON import execute it inside a
-- transaction on a newly, exclusively created destination. Runtime writes
-- replace the complete logical snapshot in one transaction. Payloads preserve
-- the complete supported JSON contract.
-- No cascading foreign keys: history and delete jobs can reference removed media.
CREATE TABLE store_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  json_version INTEGER NOT NULL CHECK (json_version BETWEEN 1 AND 8),
  next_media_id INTEGER NOT NULL CHECK (next_media_id > 0),
  next_job_id INTEGER NOT NULL CHECK (next_job_id > 0),
  next_activity_id INTEGER NOT NULL CHECK (next_activity_id > 0)
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND coalesce(json_type(payload, '$.id'), '') = 'integer' AND json_extract(payload, '$.id') = id)
);
CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  media_id INTEGER NOT NULL CHECK (media_id > 0),
  position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND coalesce(json_type(payload, '$.id'), '') = 'integer' AND json_extract(payload, '$.id') = id AND coalesce(json_type(payload, '$.mediaId'), '') = 'integer' AND json_extract(payload, '$.mediaId') = media_id)
);
CREATE TABLE activities (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  media_id INTEGER NOT NULL CHECK (media_id >= 0),
  position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND coalesce(json_type(payload, '$.id'), '') = 'integer' AND json_extract(payload, '$.id') = id AND coalesce(json_extract(payload, '$.mediaId'), 0) = media_id)
);
CREATE TABLE favorites (
  media_id INTEGER PRIMARY KEY CHECK (media_id > 0),
  position INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 0 AND 8),
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE RESTRICT
);
CREATE TABLE library_appearance (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  banner_content_type TEXT NOT NULL DEFAULT '' CHECK (banner_content_type IN ('', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  banner_data BLOB NOT NULL DEFAULT X'' CHECK (length(banner_data) <= 8388608),
  avatar_content_type TEXT NOT NULL DEFAULT '' CHECK (avatar_content_type IN ('', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  avatar_data BLOB NOT NULL DEFAULT X'' CHECK (length(avatar_data) <= 4194304),
  CHECK ((banner_content_type = '') = (length(banner_data) = 0)),
  CHECK ((avatar_content_type = '') = (length(avatar_data) = 0))
);
PRAGMA user_version = 3;
