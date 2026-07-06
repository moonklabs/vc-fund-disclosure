import type { Database } from "bun:sqlite";

export interface GuideSearchHit {
  guideId: number;
  title: string;
  publisher: string | null;
  role: string | null;
  sourceUrl: string | null;
  seq: number;
  content: string;
}

export interface InvestorRow {
  id: number;
  name: string;
  type: string | null;
  source: string;
  registered_at: string | null;
}

export interface FundRow {
  id: number;
  name: string;
  code: string | null;
  status: string | null;
  source: string;
  formed_date: string | null;
  expiry_date: string | null;
  committed_amount_krw: number | null;
  /** 운용사명 (복수 GP는 쉼표 구분) */
  investor_name: string | null;
}

export interface EventRow {
  id: number;
  event_type: string;
  entity: string | null;
  summary: string;
  occurred_at: string | null;
  created_at: string;
}

/** FTS5 trigram은 3문자 미만 질의를 지원하지 않으므로 LIKE로 폴백한다. */
function isFtsQueryable(query: string): boolean {
  return [...query].length >= 3;
}

/** FTS5 MATCH 문법 특수문자를 무력화하기 위해 문자열 리터럴로 감싼다. */
function ftsLiteral(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

/**
 * 자연어 질문을 FTS5 trigram 질의로 변환한다.
 * 공백 기준 토큰 중 3문자 이상(trigram 최소 길이)만 OR로 묶는다.
 * 유효 토큰이 없으면 null (호출부에서 LIKE 폴백).
 */
function buildFtsQuery(query: string): string | null {
  const tokens = query
    .split(/[\s,.!?·()[\]{}'"“”‘’]+/)
    .map((token) => token.trim())
    .filter((token) => [...token].length >= 3);
  if (tokens.length === 0) return null;
  return tokens.map(ftsLiteral).join(" OR ");
}

export function searchGuides(db: Database, query: string, limit = 5): GuideSearchHit[] {
  const ftsQuery = buildFtsQuery(query);
  if (ftsQuery) {
    const hits = db
      .query<GuideSearchHit, [string, number]>(
        `SELECT g.id AS guideId, g.title, g.publisher, g.role, g.source_url AS sourceUrl,
                c.seq, c.content
         FROM guide_chunks_fts f
         JOIN guide_chunks c ON c.id = f.rowid
         JOIN guides g ON g.id = c.guide_id
         WHERE guide_chunks_fts MATCH ?
         ORDER BY rank LIMIT ?`,
      )
      .all(ftsQuery, limit);
    if (hits.length > 0) return hits;
  }
  return db
    .query<GuideSearchHit, [string, number]>(
      `SELECT g.id AS guideId, g.title, g.publisher, g.role, g.source_url AS sourceUrl,
              c.seq, c.content
       FROM guide_chunks c
       JOIN guides g ON g.id = c.guide_id
       WHERE c.content LIKE '%' || ? || '%'
       ORDER BY c.guide_id, c.seq LIMIT ?`,
    )
    .all(query, limit);
}

export function searchInvestors(db: Database, query: string, limit = 20): InvestorRow[] {
  if (isFtsQueryable(query)) {
    const hits = db
      .query<InvestorRow, [string, number]>(
        `SELECT i.id, i.name, i.type, i.source, i.registered_at
         FROM investors_fts f
         JOIN investors i ON i.id = f.rowid
         WHERE investors_fts MATCH ?
         ORDER BY rank LIMIT ?`,
      )
      .all(ftsLiteral(query), limit);
    if (hits.length > 0) return hits;
  }
  return db
    .query<InvestorRow, [string, number]>(
      `SELECT id, name, type, source, registered_at
       FROM investors WHERE name LIKE '%' || ? || '%' ORDER BY name LIMIT ?`,
    )
    .all(query, limit);
}

export function searchFunds(db: Database, query: string, limit = 20): FundRow[] {
  return db
    .query<FundRow, [string, string, number]>(
      `SELECT f.id, f.name, f.code, f.status, f.source,
              f.formed_date, f.expiry_date, f.committed_amount_krw,
              (SELECT GROUP_CONCAT(i.name, ', ')
               FROM fund_operator_links l JOIN investors i ON i.id = l.investor_id
               WHERE l.fund_id = f.id) AS investor_name
       FROM funds f
       WHERE f.name LIKE '%' || ? || '%'
          OR EXISTS (
            SELECT 1 FROM fund_operator_links l
            JOIN investors i ON i.id = l.investor_id
            WHERE l.fund_id = f.id AND i.name LIKE '%' || ? || '%'
          )
       ORDER BY f.latest_evidence_at DESC, f.name LIMIT ?`,
    )
    .all(query, query, limit);
}

export function listEvents(db: Database, since?: string, limit = 50): EventRow[] {
  if (since) {
    return db
      .query<EventRow, [string, number]>(
        `SELECT id, event_type, entity, summary, occurred_at, created_at
         FROM events WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(since, limit);
  }
  return db
    .query<EventRow, [number]>(
      `SELECT id, event_type, entity, summary, occurred_at, created_at
       FROM events ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit);
}

export interface DbStatus {
  investors: number;
  funds: number;
  fundOperatorLinks: number;
  disclosures: number;
  events: number;
  guides: number;
  guideChunks: number;
  guideSources: number;
  dataQualityFlags: number;
}

export function getDbStatus(db: Database): DbStatus {
  const count = (table: string): number => {
    const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get();
    return row?.n ?? 0;
  };
  return {
    investors: count("investors"),
    funds: count("funds"),
    fundOperatorLinks: count("fund_operator_links"),
    disclosures: count("disclosures"),
    events: count("events"),
    guides: count("guides"),
    guideChunks: count("guide_chunks"),
    guideSources: count("guide_sources"),
    dataQualityFlags: count("data_quality_flags"),
  };
}
