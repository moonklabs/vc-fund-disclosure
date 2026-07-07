import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/database.ts";
import { getPolicy, setPolicyFlag } from "../src/policy.ts";
import { PolicyViolationError } from "../src/errors.ts";
import {
  KVIC_FUND_GROUPS,
  fetchKvicGroupHtml,
  fetchAndImportKvic,
  type FetchFn,
} from "../src/fetch/kvic.ts";
import { fetchAndImportDatago, recordsToCsv } from "../src/fetch/datago.ts";
import { mergeKvicPurposeRows } from "../src/parse/rows.ts";
import { searchFunds, searchInvestors } from "../src/search.ts";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "kvic-fundfinder-aa.html");

function fixtureFetch(): { fetchFn: FetchFn; calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  const html = require("node:fs").readFileSync(FIXTURE_PATH, "utf-8") as string;
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return { fetchFn, calls };
}

describe("collection policy: on_demand_fetch", () => {
  test("기본값은 OFF이고 동의로 켤 수 있다", () => {
    const db = openDatabase(":memory:");
    expect(getPolicy(db).on_demand_fetch).toBe(false);
    const next = setPolicyFlag(db, "on_demand_fetch", true);
    expect(next.on_demand_fetch).toBe(true);
  });
});

describe("fetchKvicGroupHtml", () => {
  test("알 수 없는 분류코드는 거부한다", async () => {
    expect(fetchKvicGroupHtml("ZZ")).rejects.toThrow("알 수 없는 KVIC 분류코드");
  });

  test("분류코드를 POST body에 넣어 조회한다", async () => {
    const { fetchFn, calls } = fixtureFetch();
    const snapshot = await fetchKvicGroupHtml("aa", { fetchFn });
    expect(snapshot.code).toBe("AA");
    expect(snapshot.label).toBe(KVIC_FUND_GROUPS.AA ?? "");
    expect(calls[0]?.body).toBe("ASCT_CLSS_GRP_CD_FND=AA");
    expect(snapshot.html).toContain("숭실대 SUJI");
  });

  test("에러 페이지 응답은 실패로 처리한다", async () => {
    const fetchFn: FetchFn = async () =>
      new Response("<html><head><title>error</title></head><body></body></html>", { status: 200 });
    expect(fetchKvicGroupHtml("AA", { fetchFn })).rejects.toThrow("펀드 테이블을 찾지 못했습니다");
  });
});

describe("fetchAndImportKvic", () => {
  test("동의 전에는 정책 위반으로 거부하고 네트워크에 나가지 않는다", async () => {
    const db = openDatabase(":memory:");
    const { fetchFn, calls } = fixtureFetch();
    const archiveDir = mkdtempSync(join(tmpdir(), "vc-fetch-"));
    expect(
      fetchAndImportKvic(db, { codes: ["AA"], archiveDir, fetchFn, delayMs: 0 }),
    ).rejects.toThrow(PolicyViolationError);
    expect(calls.length).toBe(0);
  });

  test("동의 후 실제 구조의 HTML을 수집→보관→정규화 import한다", async () => {
    const db = openDatabase(":memory:");
    setPolicyFlag(db, "on_demand_fetch", true);
    const { fetchFn } = fixtureFetch();
    const archiveDir = mkdtempSync(join(tmpdir(), "vc-fetch-"));

    const items = await fetchAndImportKvic(db, { codes: ["AA"], archiveDir, fetchFn, delayMs: 0 });
    expect(items).toHaveLength(1);
    const item = items[0];
    if (!item) throw new Error("import 결과 없음");
    expect(existsSync(item.filePath)).toBe(true);
    expect(item.result.duplicated).toBe(false);
    // 픽스처: 펀드 3건 (숭실대/충남대/연세대 조합)
    expect(item.result.imported.funds).toBe(3);
    expect(item.result.imported.newFunds).toBe(3);
    expect(item.result.imported.investors).toBe(3);

    // 투자목적 연속행이 펀드에 병합되어 저장된다
    const funds = searchFunds(db, "숭실대");
    expect(funds).toHaveLength(1);
    const purpose = db
      .query<{ investment_purpose: string | null }, [string]>(
        "SELECT investment_purpose FROM funds WHERE name LIKE ?",
      )
      .get("%숭실대%");
    expect(purpose?.investment_purpose).toContain("대학창업기업");

    // 결성총액 "17억\n(14억)" → 17억 원
    const amount = db
      .query<{ committed_amount_krw: number | null }, [string]>(
        "SELECT committed_amount_krw FROM funds WHERE name LIKE ?",
      )
      .get("%숭실대%");
    expect(amount?.committed_amount_krw).toBe(1_700_000_000);
  });

  test("같은 스냅샷 재수집은 duplicated로 끝난다", async () => {
    const db = openDatabase(":memory:");
    setPolicyFlag(db, "on_demand_fetch", true);
    const { fetchFn } = fixtureFetch();
    const archiveDir = mkdtempSync(join(tmpdir(), "vc-fetch-"));

    await fetchAndImportKvic(db, { codes: ["AA"], archiveDir, fetchFn, delayMs: 0 });
    const second = await fetchAndImportKvic(db, { codes: ["AA"], archiveDir, fetchFn, delayMs: 0 });
    expect(second[0]?.result.duplicated).toBe(true);
    expect(second[0]?.result.imported.newFunds).toBe(0);
  });
});

describe("fetchAndImportDatago", () => {
  test("오픈API JSON을 CSV로 보관하고 운용사를 import한다 (펀드명 없는 소스)", async () => {
    const db = openDatabase(":memory:");
    const archiveDir = mkdtempSync(join(tmpdir(), "vc-datago-"));
    const rows = [
      { 대표운영사: "프라이머", 운영사구분: "액셀러레이터", "자조합 규모(백만원)": 30000 },
      { 대표운영사: "블루포인트파트너스", 운영사구분: "액셀러레이터", "자조합 규모(백만원)": 45000 },
    ];
    const fetchFn: FetchFn = async () =>
      new Response(JSON.stringify({ data: rows, totalCount: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const outcome = await fetchAndImportDatago(db, {
      endpoint: "https://api.odcloud.kr/api/example/v1/test",
      serviceKey: "test-key",
      archiveDir,
      fetchFn,
    });
    expect(outcome.rowCount).toBe(2);
    expect(existsSync(outcome.filePath)).toBe(true);
    expect(outcome.result.imported.investors).toBe(2);
    expect(searchInvestors(db, "프라이머")).toHaveLength(1);
  });

  test("recordsToCsv는 쉼표/따옴표를 이스케이프한다", () => {
    const csv = recordsToCsv([{ a: 'x,"y"', b: 1 }]);
    expect(csv).toBe('a,b\n"x,""y""",1');
  });
});

describe("mergeKvicPurposeRows", () => {
  test("투자목적 서브헤더 잔여 행은 버리고 단독행은 직전 펀드에 병합한다", () => {
    const records = {
      headers: ["번호", "펀드명"],
      rows: [
        { 번호: "투자목적", 펀드명: "" },
        { 번호: "1", 펀드명: "테스트펀드" },
        { 번호: "대학창업, 지방", 펀드명: "" },
      ],
      warnings: [],
    };
    const merged = mergeKvicPurposeRows(records);
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]?.["투자목적"]).toBe("대학창업, 지방");
    expect(merged.headers).toContain("투자목적");
  });
});
