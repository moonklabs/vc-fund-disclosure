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
  /** canonical(대표) 행의 공시처. 전체 공시처는 sources 참조. */
  source: string;
  registered_at: string | null;
  /** 이 회사가 확인된 모든 공시처 (예: ["kvca","kvic"]). 복수면 교차 검증 신호. */
  sources: string[];
  /** name_normalized 기준으로 병합된 공시 근거 행 수. */
  evidence_count: number;
}

/** 회사 단위 롤업을 위한 내부 후보 행 (검색 매칭 결과 원본). */
interface InvestorCandidate {
  id: number;
  name: string;
  type: string | null;
  source: string;
  registered_at: string | null;
  name_normalized: string;
  latest_evidence_at: string | null;
  link_count: number;
}

/** KVCA 스냅샷은 업종을 뭉뚱그린 'VC/AC'로만 표기하므로 구체 유형보다 후순위. */
function isGenericType(type: string | null): boolean {
  return type === null || type === "VC/AC";
}

/**
 * 같은 회사(name_normalized)의 여러 공시처 행 중 canonical(대표) 행을 고른다.
 * 우선순위: 펀드 연결 보유 → 구체 업종 유형 → 최신 근거 → id 오름차순.
 */
function compareCanonical(a: InvestorCandidate, b: InvestorCandidate): number {
  if (a.link_count !== b.link_count) return b.link_count - a.link_count;
  const aGeneric = isGenericType(a.type) ? 1 : 0;
  const bGeneric = isGenericType(b.type) ? 1 : 0;
  if (aGeneric !== bGeneric) return aGeneric - bGeneric;
  const aEvidence = a.latest_evidence_at ?? "";
  const bEvidence = b.latest_evidence_at ?? "";
  if (aEvidence !== bEvidence) return aEvidence < bEvidence ? 1 : -1;
  return a.id - b.id;
}

/**
 * 검색 후보 행을 name_normalized 기준으로 병합한다.
 * KVIC/KVCA 등 공시처별로 중복 적재된 동일 회사를 한 건으로 롤업하되,
 * 후보 순서(FTS rank 또는 이름순)를 보존하고 limit까지 자른다.
 */
function rollupInvestors(candidates: InvestorCandidate[], limit: number): InvestorRow[] {
  const groups = new Map<string, InvestorCandidate[]>();
  const order: string[] = [];
  for (const row of candidates) {
    const existing = groups.get(row.name_normalized);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.name_normalized, [row]);
      order.push(row.name_normalized);
    }
  }

  const results: InvestorRow[] = [];
  for (const key of order) {
    if (results.length >= limit) break;
    const rows = groups.get(key)!;
    const canonical = [...rows].sort(compareCanonical)[0]!;
    const sources = [...new Set(rows.map((row) => row.source))].sort();
    results.push({
      id: canonical.id,
      name: canonical.name,
      type: canonical.type,
      source: canonical.source,
      registered_at: canonical.registered_at,
      sources,
      evidence_count: rows.length,
    });
  }
  return results;
}

const INVESTOR_CANDIDATE_COLUMNS = `i.id, i.name, i.type, i.source, i.registered_at,
        i.name_normalized, i.latest_evidence_at,
        (SELECT COUNT(*) FROM fund_operator_links l WHERE l.investor_id = i.id) AS link_count`;

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
  // limit은 롤업(회사 단위 병합) 이후에 적용해야 하므로 후보는 제한 없이 모두 조회한다.
  // (investors 테이블은 수백 행 규모라 전량 매칭 스캔 비용이 무시할 만하다.)
  if (isFtsQueryable(query)) {
    const hits = db
      .query<InvestorCandidate, [string]>(
        `SELECT ${INVESTOR_CANDIDATE_COLUMNS}
         FROM investors_fts f
         JOIN investors i ON i.id = f.rowid
         WHERE investors_fts MATCH ?
         ORDER BY rank`,
      )
      .all(ftsLiteral(query));
    if (hits.length > 0) return rollupInvestors(hits, limit);
  }
  const candidates = db
    .query<InvestorCandidate, [string]>(
      `SELECT ${INVESTOR_CANDIDATE_COLUMNS}
       FROM investors i
       WHERE i.name LIKE '%' || ? || '%' ORDER BY i.name`,
    )
    .all(query);
  return rollupInvestors(candidates, limit);
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
