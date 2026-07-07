import type { Database } from "bun:sqlite";
import { parse } from "node-html-parser";
import { normalizeKey } from "../normalize/text.ts";
import { getPolicy } from "../policy.ts";
import { PolicyViolationError } from "../errors.ts";
import type { FetchFn } from "./kvic.ts";

/**
 * KVCA DIVA(벤처투자공시시스템) 온디맨드 수집.
 * - 벤처투자촉진법상 조합 결성/변경/해산을 전자공시하는 법정 채널이다.
 * - robots.txt가 `Disallow: /`이므로 KVIC과 동일하게 on_demand_fetch 동의 게이트를 따른다.
 * - 목록 레벨(회사명·공시일자·보고서명)만 수집한다. 상세 보고서 본문은 수집하지 않는다.
 */

export const DIVA_BASE = "http://diva.kvca.or.kr";
export const DIVA_MAIN_PATH = "/div/cmn/DivDisclsMainInq";

/** 공시 유형별 목록 endpoint. */
export const DIVA_LIST_PATHS = Object.freeze({
  tmly: "/div/dic/DivTmlydisclsListInq", // 수시공시 (결성/변경/해산 등)
  regul: "/div/dic/DivReguldisclsListInq", // 정기공시
});

export type DivaDisclosureType = keyof typeof DIVA_LIST_PATHS;

/** 조회 기간 코드. */
export const DIVA_PERIOD_CODES = Object.freeze({
  "1m": "1",
  "6m": "6",
  "1y": "12",
  all: "0",
});

export type DivaPeriod = keyof typeof DIVA_PERIOD_CODES;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const DIVA_FETCH_NOTICE = `KVCA DIVA 온디맨드 수집은 사용자 동의가 필요합니다.

- 대상: ${DIVA_BASE} (한국벤처캐피탈협회 벤처투자공시시스템)
- 이 사이트의 robots.txt는 자동 수집을 허용하지 않습니다 (Disallow: /).
- 이 기능은 백그라운드 크롤러가 아니라, 사용자 명령 실행 시 공시 목록을
  페이지 단위로 조회하는 브라우저 방문과 동일한 동작입니다.
- 요청 간 지연을 두고, 목록(회사명·공시일자·보고서명)만 로컬에 보관합니다.

동의는 KVIC과 공유됩니다. 다음 명령으로 1회 동의를 저장하세요:
  vc-funds fetch diva --consent`;

export interface DivaListRow {
  seq: number;
  disclosedDate: string | null;
  companyName: string;
  operInstId: string | null;
  disclosureYyMm: string | null;
  reportName: string | null;
}

/** DIVA 목록 HTML 한 페이지를 행 배열로 파싱한다. */
export function parseDivaList(html: string): DivaListRow[] {
  const root = parse(html);
  const rows: DivaListRow[] = [];
  for (const tr of root.querySelectorAll("tr")) {
    const cells = tr.querySelectorAll("td");
    if (cells.length < 4) continue;
    const seqText = cells[0]?.text.trim() ?? "";
    if (!/^\d+$/.test(seqText)) continue;

    const companyLink = cells[2]?.querySelector("a");
    const companyName = (companyLink?.text ?? cells[2]?.text ?? "").trim();
    if (!companyName) continue;

    const onclick =
      companyLink?.getAttribute("onclick") ??
      cells[3]?.querySelector("a")?.getAttribute("onclick") ??
      "";
    const idMatch = onclick.match(/'([A-Z]{2}\d+)'\s*,\s*'(\d{6})'/);

    rows.push({
      seq: Number(seqText),
      disclosedDate: cells[1]?.text.trim() || null,
      companyName,
      operInstId: idMatch?.[1] ?? null,
      disclosureYyMm: idMatch?.[2] ?? null,
      reportName: cells[3]?.text.trim() || null,
    });
  }
  return rows;
}

export function ensureDivaFetchEnabled(db: Database): void {
  if (!getPolicy(db).on_demand_fetch) {
    throw new PolicyViolationError(DIVA_FETCH_NOTICE);
  }
}

export interface DivaFetchOptions {
  fetchFn?: FetchFn;
  baseUrl?: string;
}

/** 공시 목록 한 페이지를 조회한다. */
export async function fetchDivaListPage(
  type: DivaDisclosureType,
  period: DivaPeriod,
  pageIndex: number,
  options: DivaFetchOptions = {},
): Promise<DivaListRow[]> {
  const base = options.baseUrl ?? DIVA_BASE;
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(`${base}${DIVA_LIST_PATHS[type]}`, {
    method: "POST",
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      Referer: `${base}${DIVA_MAIN_PATH}`,
    },
    body: `S_COND_PD_CD=${DIVA_PERIOD_CODES[period]}&S_DISCLS_TP_CD=&PAGE_INDEX=${pageIndex}`,
  });
  if (!response.ok) {
    throw new Error(`DIVA 조회 실패 (HTTP ${response.status}, type=${type}, page=${pageIndex})`);
  }
  return parseDivaList(await response.text());
}

export interface DivaFetchInput extends DivaFetchOptions {
  type?: DivaDisclosureType;
  period?: DivaPeriod;
  /** 조회할 최대 페이지 수 (페이지당 5행, 기본 20 = 최근 100건) */
  maxPages?: number;
  /** 요청 간 지연 ms (기본 1200) */
  delayMs?: number;
}

export interface DivaFetchResult {
  type: DivaDisclosureType;
  period: DivaPeriod;
  pagesFetched: number;
  rows: number;
  newInvestors: number;
  disclosureEvents: number;
}

/**
 * DIVA 공시 목록을 순회 수집해 investors upsert + diva_disclosure 이벤트로 적재한다.
 * on_demand_fetch 동의가 선행되어야 한다. 페이지가 이전과 동일하면(마지막 페이지 반복) 중단한다.
 */
export async function fetchAndImportDiva(
  db: Database,
  input: DivaFetchInput = {},
): Promise<DivaFetchResult> {
  ensureDivaFetchEnabled(db);
  const type = input.type ?? "tmly";
  const period = input.period ?? "1y";
  const maxPages = input.maxPages ?? 20;
  const delayMs = input.delayMs ?? 1200;

  const result: DivaFetchResult = {
    type,
    period,
    pagesFetched: 0,
    rows: 0,
    newInvestors: 0,
    disclosureEvents: 0,
  };
  const seenSeq = new Set<number>();
  const capturedAt = new Date().toISOString();

  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const rows = await fetchDivaListPage(type, period, page, input);
    if (rows.length === 0) break;
    // 마지막 페이지가 반복되면(동일 seq 집합) 중단
    if (rows.every((row) => seenSeq.has(row.seq))) break;

    const applied = importDivaRows(db, rows, { type, capturedAt });
    result.rows += applied.rows;
    result.newInvestors += applied.newInvestors;
    result.disclosureEvents += applied.disclosureEvents;
    result.pagesFetched = page;
    for (const row of rows) seenSeq.add(row.seq);
  }
  return result;
}

interface DivaImportContext {
  type: DivaDisclosureType;
  capturedAt: string;
}

function importDivaRows(
  db: Database,
  rows: DivaListRow[],
  context: DivaImportContext,
): { rows: number; newInvestors: number; disclosureEvents: number } {
  let newInvestors = 0;
  let disclosureEvents = 0;

  const run = db.transaction(() => {
    for (const row of rows) {
      const existing = db
        .query<{ id: number }, [string]>(
          "SELECT id FROM investors WHERE name_normalized = ? AND source = 'kvca'",
        )
        .get(normalizeKey(row.companyName));

      db.query(
        `INSERT INTO investors (name, name_normalized, type, source, trust_level, latest_evidence_at)
         VALUES (?, ?, 'VC/AC', 'kvca', 'official_snapshot', ?)
         ON CONFLICT(name_normalized, source) DO UPDATE SET
           name = excluded.name,
           latest_evidence_at = excluded.latest_evidence_at`,
      ).run(row.companyName, normalizeKey(row.companyName), context.capturedAt);
      if (!existing) newInvestors += 1;

      // 공시 이벤트: 같은 (회사, 공시년월, 보고서명)은 중복 삽입하지 않는다
      const summary = `DIVA ${context.type === "tmly" ? "수시" : "정기"}공시: ${row.companyName} — ${row.reportName ?? ""}`;
      const dupe = db
        .query<{ id: number }, [string]>(
          "SELECT id FROM events WHERE event_type = 'diva_disclosure' AND summary = ?",
        )
        .get(summary);
      if (!dupe) {
        db.query(
          `INSERT INTO events (event_type, entity, summary, occurred_at)
           VALUES ('diva_disclosure', ?, ?, ?)`,
        ).run(row.companyName, summary, row.disclosedDate);
        disclosureEvents += 1;
      }
    }
  });
  run();
  return { rows: rows.length, newInvestors, disclosureEvents };
}
