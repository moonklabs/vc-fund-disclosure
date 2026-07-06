/**
 * SQLite 스키마 v1.
 * - 공시 evidence(disclosures/funds/investors/events)와
 *   창업자 guide(guides/guide_chunks/guide_sources)를 분리 저장한다.
 * - 한국어 부분 문자열 검색을 위해 FTS5 trigram tokenizer를 사용한다.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investors (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  type            TEXT,                -- VC | AC | LLC | CVC | etc
  source          TEXT NOT NULL,       -- kvic | kvca | tips | manual
  registered_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name_normalized, source)
);

CREATE TABLE IF NOT EXISTS funds (
  id           INTEGER PRIMARY KEY,
  investor_id  INTEGER REFERENCES investors(id),
  name         TEXT NOT NULL,
  code         TEXT,
  vintage      TEXT,
  size_krw     INTEGER,
  status       TEXT,
  source       TEXT NOT NULL,
  disclosed_at TEXT,
  raw_json     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 사용자가 import한 원본 스냅샷/문서 (공시 evidence의 근거)
CREATE TABLE IF NOT EXISTS disclosures (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,          -- kvic | kvca | tips | manual
  kind         TEXT NOT NULL,          -- html_snapshot | csv | xls | pdf | hwpx | text
  file_path    TEXT,
  sha256       TEXT NOT NULL UNIQUE,
  imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
  parse_status TEXT NOT NULL DEFAULT 'raw',   -- raw | parsed | failed
  meta_json    TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY,
  disclosure_id INTEGER REFERENCES disclosures(id),
  event_type    TEXT NOT NULL,         -- snapshot_imported | new_fund | fund_update | investor_update
  entity        TEXT,
  summary       TEXT NOT NULL,
  occurred_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 원격 링크가 사라진 자료 등 URL 후보 (실제 파일 import와 분리)
CREATE TABLE IF NOT EXISTS guide_sources (
  id            INTEGER PRIMARY KEY,
  publisher     TEXT,
  url           TEXT NOT NULL UNIQUE,
  role          TEXT,                  -- founder_education | tips | ir | dataroom | term_sheet
  access_status TEXT NOT NULL DEFAULT 'unknown',  -- ok | remote_gone_410 | forbidden | unknown
  checked_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guides (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  publisher   TEXT,
  role        TEXT,
  file_path   TEXT,
  source_url  TEXT,
  sha256      TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guide_chunks (
  id       INTEGER PRIMARY KEY,
  guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  content  TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS guide_chunks_fts USING fts5(
  content,
  content='guide_chunks',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS guide_chunks_ai AFTER INSERT ON guide_chunks BEGIN
  INSERT INTO guide_chunks_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS guide_chunks_ad AFTER DELETE ON guide_chunks BEGIN
  INSERT INTO guide_chunks_fts(guide_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS investors_fts USING fts5(
  name,
  content='investors',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS investors_ai AFTER INSERT ON investors BEGIN
  INSERT INTO investors_fts(rowid, name) VALUES (new.id, new.name);
END;

CREATE TRIGGER IF NOT EXISTS investors_ad AFTER DELETE ON investors BEGIN
  INSERT INTO investors_fts(investors_fts, rowid, name) VALUES ('delete', old.id, old.name);
END;

CREATE INDEX IF NOT EXISTS idx_funds_investor ON funds(investor_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_guide_chunks_guide ON guide_chunks(guide_id);
`;
