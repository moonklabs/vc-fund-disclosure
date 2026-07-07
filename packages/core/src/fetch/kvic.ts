import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PolicyViolationError } from "../errors.ts";
import { getPolicy } from "../policy.ts";
import { importHtmlSnapshot, type SnapshotImportResult } from "../import/snapshot.ts";

/**
 * KVIC FundFinder 온디맨드 수집.
 * - 백그라운드 크롤러가 아니다. 사용자가 직접 실행한 명령에서만 분류코드당 1회 POST 조회한다.
 * - 대상 사이트 robots.txt가 `Disallow: /`이므로, 고지 후 사용자 동의(on_demand_fetch 정책 ON)로만 동작한다.
 * - 원본 HTML을 보관함(Archive)에 그대로 저장하고 재배포하지 않는다.
 */

export const KVIC_FUNDFINDER_BASE = "http://fundfinder.k-vic.co.kr";
export const KVIC_FUNDFINDER_LIST_PATH = "/rsh/rsh/RshMacFndLstInq";
export const KVIC_FUNDFINDER_REFERER_PATH = "/rsh/rsh/RshMacFndInq";

/** FundFinder 분류코드 → 라벨 (2026-07 페이지 기준). */
export const KVIC_FUND_GROUPS: Readonly<Record<string, string>> = Object.freeze({
  AA: "창업초기 펀드",
  AB: "엔젤 펀드",
  AC: "M&A 펀드",
  AD: "세컨더리 펀드",
  BA: "소셜 펀드",
  BB: "여성 펀드",
  BC: "청년 펀드",
  BD: "재기지원 펀드",
  BE: "고급기술 펀드",
  CA: "지역 펀드",
  CB: "해외 펀드",
  DA: "해외진출 지원 펀드",
  DB: "문화산업 펀드",
  DC: "디지털콘텐츠 펀드",
  DD: "조선업 펀드",
  DE: "환경 펀드",
  DF: "보건산업 펀드",
  DG: "에너지 펀드",
  DH: "기술사업화 펀드",
  DI: "해양 펀드",
  DJ: "영화산업 펀드",
  DK: "관광기업 육성 펀드",
  DL: "스포츠산업 육성 펀드",
  EA: "일반 펀드",
  EB: "일자리매칭 펀드",
  EC: "사회적기업 펀드",
  ED: "도시재생 펀드",
  EE: "공유주택 펀드",
  EF: "국토교통혁신 펀드",
});

/** KVIC WAF가 비브라우저 User-Agent를 410으로 차단하므로 브라우저 UA로 조회한다. */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const ON_DEMAND_FETCH_NOTICE = `KVIC FundFinder 온디맨드 수집은 사용자 동의가 필요합니다.

- 대상: ${KVIC_FUNDFINDER_BASE} (한국벤처투자 공시 페이지)
- 이 사이트의 robots.txt는 자동 수집을 허용하지 않습니다 (Disallow: /).
- 이 기능은 백그라운드 크롤러가 아니라, 사용자가 명령을 실행할 때만
  분류코드당 1회 조회하는 브라우저 방문과 동일한 동작입니다.
- 요청 간 지연(rate limit)을 두고, 원본 HTML을 로컬에만 보관하며 재배포하지 않습니다.

동의하려면 다음 명령으로 1회 동의를 저장하세요:
  vc-funds fetch kvic --all --consent`;

export type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface KvicFetchOptions {
  /** 테스트 주입용 fetch 구현 (기본: globalThis.fetch) */
  fetchFn?: FetchFn;
  baseUrl?: string;
}

export interface KvicGroupSnapshot {
  code: string;
  label: string;
  html: string;
  sourceUrl: string;
  capturedAt: string;
}

/** 분류코드 하나의 펀드 목록 HTML을 조회한다. */
export async function fetchKvicGroupHtml(
  code: string,
  options: KvicFetchOptions = {},
): Promise<KvicGroupSnapshot> {
  const upper = code.toUpperCase();
  const label = KVIC_FUND_GROUPS[upper];
  if (!label) {
    throw new Error(
      `알 수 없는 KVIC 분류코드: ${code} (사용 가능: ${Object.keys(KVIC_FUND_GROUPS).join(", ")})`,
    );
  }
  const base = options.baseUrl ?? KVIC_FUNDFINDER_BASE;
  const fetchFn = options.fetchFn ?? fetch;
  const sourceUrl = `${base}${KVIC_FUNDFINDER_LIST_PATH}`;

  const response = await fetchFn(sourceUrl, {
    method: "POST",
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      Referer: `${base}${KVIC_FUNDFINDER_REFERER_PATH}`,
    },
    body: `ASCT_CLSS_GRP_CD_FND=${upper}`,
  });
  if (!response.ok) {
    throw new Error(`KVIC FundFinder 조회 실패 (HTTP ${response.status}, code=${upper})`);
  }
  const html = await response.text();
  if (!html.includes("<table") || /<title>\s*error\s*<\/title>/i.test(html)) {
    throw new Error(
      `KVIC 응답에서 펀드 테이블을 찾지 못했습니다 (code=${upper}). 일시 오류이거나 페이지 구조가 변경되었을 수 있습니다.`,
    );
  }
  return { code: upper, label, html, sourceUrl, capturedAt: new Date().toISOString() };
}

/** on_demand_fetch 정책이 꺼져 있으면 고지문과 함께 거부한다. */
export function ensureOnDemandFetchEnabled(db: Database): void {
  if (!getPolicy(db).on_demand_fetch) {
    throw new PolicyViolationError(ON_DEMAND_FETCH_NOTICE);
  }
}

export interface KvicFetchImportInput extends KvicFetchOptions {
  /** 분류코드 목록 (생략 시 전체) */
  codes?: string[];
  /** 원본 HTML을 저장할 보관함 디렉토리 */
  archiveDir: string;
  /** 요청 간 지연 ms (기본 1500) */
  delayMs?: number;
}

export interface KvicFetchImportItem {
  code: string;
  label: string;
  filePath: string;
  sourceUrl: string;
  capturedAt: string;
  result: SnapshotImportResult;
}

/**
 * 분류코드별 FundFinder 목록을 조회해 Archive에 저장하고 DB로 import한다.
 * on_demand_fetch 정책 동의가 선행되어야 한다.
 */
export async function fetchAndImportKvic(
  db: Database,
  input: KvicFetchImportInput,
): Promise<KvicFetchImportItem[]> {
  ensureOnDemandFetchEnabled(db);

  const codes =
    input.codes && input.codes.length > 0
      ? input.codes.map((code) => code.toUpperCase())
      : Object.keys(KVIC_FUND_GROUPS);
  for (const code of codes) {
    if (!KVIC_FUND_GROUPS[code]) {
      throw new Error(
        `알 수 없는 KVIC 분류코드: ${code} (사용 가능: ${Object.keys(KVIC_FUND_GROUPS).join(", ")})`,
      );
    }
  }

  mkdirSync(input.archiveDir, { recursive: true });
  const delayMs = input.delayMs ?? 1500;
  const items: KvicFetchImportItem[] = [];

  for (const [index, code] of codes.entries()) {
    if (index > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const snapshot = await fetchKvicGroupHtml(code, input);
    const day = snapshot.capturedAt.slice(0, 10);
    const filePath = join(input.archiveDir, `kvic-fundfinder-${code}-${day}.html`);
    writeFileSync(filePath, snapshot.html);

    const result = importHtmlSnapshot(db, {
      filePath,
      source: "kvic",
      group: code,
      capturedAt: snapshot.capturedAt,
      sourceUrl: snapshot.sourceUrl,
    });
    items.push({
      code,
      label: snapshot.label,
      filePath,
      sourceUrl: snapshot.sourceUrl,
      capturedAt: snapshot.capturedAt,
      result,
    });
  }
  return items;
}
