/**
 * SQLite 스키마 v2.
 * - 공시 evidence(disclosures/funds/investors/events)와
 *   창업자 guide(guides/guide_chunks/guide_sources)를 분리 저장한다.
 * - 한국어 부분 문자열 검색을 위해 FTS5 trigram tokenizer를 사용한다.
 * - v2: KVIC/KVCA 정규화 엔티티 계층 추가 (k-startup-plugins 스펙 팩 이식)
 *   funds 확장 컬럼, fund_operator_links(복수 운용사), fund_investment_focus,
 *   investor_aliases, data_quality_flags.
 */
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investors (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  name_normalized    TEXT NOT NULL,
  type               TEXT,                -- VC | AC | LLC | CVC | etc
  source             TEXT NOT NULL,       -- kvic | kvca | tips | manual
  registered_at      TEXT,
  trust_level        TEXT NOT NULL DEFAULT 'derived',   -- official_snapshot | derived
  latest_evidence_at TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name_normalized, source)
);

CREATE TABLE IF NOT EXISTS investor_aliases (
  id               INTEGER PRIMARY KEY,
  investor_id      INTEGER NOT NULL REFERENCES investors(id),
  alias            TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  source           TEXT,
  UNIQUE(alias_normalized, investor_id)
);

CREATE TABLE IF NOT EXISTS funds (
  id                   INTEGER PRIMARY KEY,
  investor_id          INTEGER REFERENCES investors(id),  -- deprecated: fund_operator_links 사용
  name                 TEXT NOT NULL,
  name_normalized      TEXT,
  code                 TEXT,               -- KVCA asct_id 등 외부 식별자
  vintage              TEXT,
  size_krw             INTEGER,            -- deprecated: committed_amount_krw 사용
  status               TEXT,
  source               TEXT NOT NULL,
  disclosed_at         TEXT,
  formed_date          TEXT,
  registered_date      TEXT,
  expiry_date          TEXT,
  committed_amount_krw INTEGER,
  invested_amount_krw  INTEGER,
  mfund_invested_krw   INTEGER,
  duration_text        TEXT,
  investment_purpose   TEXT,
  trust_level          TEXT NOT NULL DEFAULT 'official_snapshot',
  latest_evidence_at   TEXT,
  raw_json             TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_funds_name_source ON funds(name_normalized, source);

-- 펀드 ↔ 운용사(복수 GP 지원). 근거 disclosure에 연결.
CREATE TABLE IF NOT EXISTS fund_operator_links (
  id            INTEGER PRIMARY KEY,
  fund_id       INTEGER NOT NULL REFERENCES funds(id),
  investor_id   INTEGER NOT NULL REFERENCES investors(id),
  role          TEXT NOT NULL DEFAULT 'operator',
  disclosure_id INTEGER REFERENCES disclosures(id),
  confidence    TEXT NOT NULL DEFAULT 'high',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fund_id, investor_id, role)
);

-- KVIC FundFinder 투자분야/단계/지역 신호
CREATE TABLE IF NOT EXISTS fund_investment_focus (
  id               INTEGER PRIMARY KEY,
  fund_id          INTEGER NOT NULL REFERENCES funds(id),
  category_code    TEXT,
  subcategory_code TEXT,
  category_name    TEXT,
  subcategory_name TEXT,
  sector_keyword   TEXT,
  startup_stage    TEXT,
  region           TEXT,
  disclosure_id    INTEGER REFERENCES disclosures(id),
  UNIQUE(fund_id, category_code, category_name, subcategory_name, sector_keyword, startup_stage)
);

-- import 중 발견한 데이터 품질 문제 (파싱 실패, 필수 필드 누락 등)
CREATE TABLE IF NOT EXISTS data_quality_flags (
  id            INTEGER PRIMARY KEY,
  entity_type   TEXT NOT NULL,       -- fund | investor | disclosure
  entity_id     INTEGER,
  severity      TEXT NOT NULL DEFAULT 'warning',   -- critical | warning
  flag_type     TEXT NOT NULL,
  message       TEXT NOT NULL,
  source        TEXT,
  disclosure_id INTEGER REFERENCES disclosures(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id, message)
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
CREATE INDEX IF NOT EXISTS idx_operator_links_investor ON fund_operator_links(investor_id);
`;

/**
 * 버전별 업그레이드 SQL. 신규 테이블은 SCHEMA_SQL의 IF NOT EXISTS가 처리하므로
 * 여기에는 기존 테이블의 ALTER만 둔다.
 */
export const MIGRATIONS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  2: [
    "ALTER TABLE investors ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'derived'",
    "ALTER TABLE investors ADD COLUMN latest_evidence_at TEXT",
    "ALTER TABLE funds ADD COLUMN name_normalized TEXT",
    "ALTER TABLE funds ADD COLUMN formed_date TEXT",
    "ALTER TABLE funds ADD COLUMN registered_date TEXT",
    "ALTER TABLE funds ADD COLUMN expiry_date TEXT",
    "ALTER TABLE funds ADD COLUMN committed_amount_krw INTEGER",
    "ALTER TABLE funds ADD COLUMN invested_amount_krw INTEGER",
    "ALTER TABLE funds ADD COLUMN mfund_invested_krw INTEGER",
    "ALTER TABLE funds ADD COLUMN duration_text TEXT",
    "ALTER TABLE funds ADD COLUMN investment_purpose TEXT",
    "ALTER TABLE funds ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'official_snapshot'",
    "ALTER TABLE funds ADD COLUMN latest_evidence_at TEXT",
  ],
});
