import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importHtmlSnapshot, type SnapshotImportResult } from "../import/snapshot.ts";
import type { FetchFn } from "./kvic.ts";

/**
 * 공공데이터포털(data.go.kr) 오픈API 수집.
 * 공식 개방 데이터(활용신청으로 발급받은 serviceKey 필요, 라이선스 "이용허락범위 제한 없음")이므로
 * on_demand_fetch 동의 게이트 대상이 아니다. serviceKey 제공 자체가 공식 허가에 해당한다.
 *
 * 기본 대상: 한국벤처투자_모태펀드 자조합 운용사정보
 * https://www.data.go.kr/data/3060708/fileData.do
 */

export interface DatagoFetchInput {
  /** odcloud API endpoint (예: https://api.odcloud.kr/api/...) */
  endpoint: string;
  /** data.go.kr 활용신청으로 발급받은 인증키 */
  serviceKey: string;
  page?: number;
  perPage?: number;
  fetchFn?: FetchFn;
}

export interface DatagoRows {
  rows: Array<Record<string, unknown>>;
  totalCount: number;
}

/** odcloud 표준 응답({ data, totalCount })에서 행 배열을 가져온다. */
export async function fetchDatagoRows(input: DatagoFetchInput): Promise<DatagoRows> {
  const url = new URL(input.endpoint);
  url.searchParams.set("serviceKey", input.serviceKey);
  url.searchParams.set("page", String(input.page ?? 1));
  url.searchParams.set("perPage", String(input.perPage ?? 1000));

  const fetchFn = input.fetchFn ?? fetch;
  const response = await fetchFn(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`data.go.kr 조회 실패 (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as { data?: unknown; totalCount?: number };
  if (!Array.isArray(payload.data)) {
    throw new Error("data.go.kr 응답 형식이 예상과 다릅니다 (data 배열 없음).");
  }
  return {
    rows: payload.data as Array<Record<string, unknown>>,
    totalCount: payload.totalCount ?? payload.data.length,
  };
}

/** JSON 행 배열을 기존 CSV import 파이프라인이 소화하는 CSV 텍스트로 변환한다. */
export function recordsToCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ];
  return lines.join("\n");
}

export interface DatagoImportInput extends DatagoFetchInput {
  /** 원본 CSV를 저장할 보관함 디렉토리 */
  archiveDir: string;
  /** DB source 태그 (기본 kvic — KVIC 개방 데이터셋 기준) */
  source?: "kvic" | "kvca" | "tips" | "manual";
  /** 저장 파일명 라벨 (기본 datago) */
  label?: string;
}

export interface DatagoImportResult {
  filePath: string;
  rowCount: number;
  totalCount: number;
  result: SnapshotImportResult;
}

/** 오픈API 행을 CSV로 보관하고 기존 스냅샷 파이프라인으로 import한다. */
export async function fetchAndImportDatago(
  db: Database,
  input: DatagoImportInput,
): Promise<DatagoImportResult> {
  const { rows, totalCount } = await fetchDatagoRows(input);
  if (rows.length === 0) {
    throw new Error("data.go.kr 응답에 데이터가 없습니다.");
  }

  mkdirSync(input.archiveDir, { recursive: true });
  const capturedAt = new Date().toISOString();
  const label = input.label ?? "datago";
  const filePath = join(input.archiveDir, `datago-${label}-${capturedAt.slice(0, 10)}.csv`);
  writeFileSync(filePath, recordsToCsv(rows));

  const result = importHtmlSnapshot(db, {
    filePath,
    source: input.source ?? "kvic",
    capturedAt,
    sourceUrl: input.endpoint,
  });
  return { filePath, rowCount: rows.length, totalCount, result };
}
