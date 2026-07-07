import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/db/database.ts";
import { getPolicy, setPolicyFlag } from "../src/policy.ts";
import { PolicyViolationError } from "../src/errors.ts";
import {
  parseDivaList,
  fetchAndImportDiva,
  DATAGO_KVIC_PRESETS,
} from "../src/index.ts";
import type { FetchFn } from "../src/fetch/kvic.ts";
import { searchInvestors, listEvents } from "../src/search.ts";

const FIXTURE = readFileSync(
  join(import.meta.dir, "fixtures", "diva-tmly-list.html"),
  "utf-8",
);

describe("parseDivaList", () => {
  test("공시일자·회사명·운용사ID·보고서명을 추출한다", () => {
    const rows = parseDivaList(FIXTURE);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const first = rows[0];
    if (!first) throw new Error("행 없음");
    expect(first.companyName).toBe("500글로벌매니지먼트코리아");
    expect(first.disclosedDate).toBe("2026-06-27");
    expect(first.operInstId).toBe("OP20220735");
    expect(first.disclosureYyMm).toBe("202605");
    expect(first.reportName).toContain("수시공시");
  });
});

describe("fetchAndImportDiva", () => {
  function fixtureFetch(): { fetchFn: FetchFn; count: () => number } {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls += 1;
      // 1페이지는 데이터, 2페이지부터는 동일 반복(마지막 페이지) → 조기 종료 검증
      return new Response(FIXTURE, { status: 200, headers: { "Content-Type": "text/html" } });
    };
    return { fetchFn, count: () => calls };
  }

  test("동의 전에는 거부하고 네트워크에 나가지 않는다", async () => {
    const db = openDatabase(":memory:");
    const { fetchFn, count } = fixtureFetch();
    expect(fetchAndImportDiva(db, { fetchFn, delayMs: 0 })).rejects.toThrow(PolicyViolationError);
    expect(count()).toBe(0);
  });

  test("동의 후 공시 목록을 investors + diva_disclosure 이벤트로 적재한다", async () => {
    const db = openDatabase(":memory:");
    setPolicyFlag(db, "on_demand_fetch", true);
    const { fetchFn } = fixtureFetch();

    const result = await fetchAndImportDiva(db, { fetchFn, maxPages: 5, delayMs: 0 });
    // 동일 페이지 반복이므로 2페이지째에서 조기 종료 (seq 중복 감지)
    expect(result.pagesFetched).toBe(1);
    expect(result.newInvestors).toBeGreaterThanOrEqual(5);
    expect(result.disclosureEvents).toBeGreaterThanOrEqual(5);

    expect(searchInvestors(db, "가이아벤처파트너스")).toHaveLength(1);
    const events = listEvents(db);
    expect(events.some((e) => e.event_type === "diva_disclosure")).toBe(true);
  });

  test("재수집 시 동일 공시 이벤트는 중복 삽입하지 않는다", async () => {
    const db = openDatabase(":memory:");
    setPolicyFlag(db, "on_demand_fetch", true);
    const { fetchFn } = fixtureFetch();

    await fetchAndImportDiva(db, { fetchFn, maxPages: 3, delayMs: 0 });
    const before = listEvents(db, undefined, 500).filter((e) => e.event_type === "diva_disclosure").length;
    const second = await fetchAndImportDiva(db, { fetchFn, maxPages: 3, delayMs: 0 });
    expect(second.disclosureEvents).toBe(0);
    const after = listEvents(db, undefined, 500).filter((e) => e.event_type === "diva_disclosure").length;
    expect(after).toBe(before);
  });
});

describe("DATAGO_KVIC_PRESETS", () => {
  test("자조합 현황 preset이 odcloud endpoint를 가진다", () => {
    expect(DATAGO_KVIC_PRESETS.associations.endpoint).toContain("api.odcloud.kr/api/15123555");
    expect(DATAGO_KVIC_PRESETS.operators.endpoint).toContain("3060708");
    expect(Object.keys(DATAGO_KVIC_PRESETS).length).toBe(4);
  });
});
