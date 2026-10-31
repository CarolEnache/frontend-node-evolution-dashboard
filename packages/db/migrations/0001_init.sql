CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT,
  date TEXT NOT NULL,
  url TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  raw TEXT NOT NULL DEFAULT 'null',
  similarity REAL,
  gap TEXT,
  worth_learning TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS entries_source_date_idx ON entries (source, date);
CREATE INDEX IF NOT EXISTS entries_gap_date_idx ON entries (gap, date);

CREATE TABLE IF NOT EXISTS source_state (
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  version TEXT,
  last_fetched_at TEXT,
  last_success_at TEXT,
  PRIMARY KEY (source, url)
);

CREATE TABLE IF NOT EXISTS embeddings (
  cache_key TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (cache_key, model, kind)
);
