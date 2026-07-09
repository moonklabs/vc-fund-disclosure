import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../src/db/database.ts";
import { searchInvestors } from "../src/search.ts";

/** 지정 공시처 행을 삽입하고 id를 돌려준다. */
function insertInvestor(
  db: Database,
  opts: {
    name: string;
    normalized: string;
    source: string;
    type?: string | null;
    latestEvidenceAt?: string | null;
  },
): number {
  db.query(
    `INSERT INTO investors (name, name_normalized, type, source, latest_evidence_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    opts.name,
    opts.normalized,
    opts.type ?? null,
    opts.source,
    opts.latestEvidenceAt ?? null,
  );
  return Number(
    db.query<{ id: number }, [string, string]>(
      "SELECT id FROM investors WHERE name = ? AND source = ?",
    ).get(opts.name, opts.source)?.id,
  );
}

/** 특정 투자사에 펀드 연결(operator link) N건을 부여한다. */
function linkFunds(db: Database, investorId: number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    db.query("INSERT INTO funds (name, source) VALUES (?, 'kvic')").run(
      `펀드-${investorId}-${i}`,
    );
    const fundId = Number(
      db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id,
    );
    db.query(
      "INSERT INTO fund_operator_links (fund_id, investor_id) VALUES (?, ?)",
    ).run(fundId, investorId);
  }
}

describe("searchInvestors 회사 단위 롤업", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  test("KVIC/KVCA 중복 쌍을 한 건으로 병합하고 sources를 집계한다", () => {
    const kvic = insertInvestor(db, {
      name: "가이아벤처파트너스",
      normalized: "가이아벤처파트너스",
      source: "kvic",
      type: "LLC",
    });
    linkFunds(db, kvic, 9);
    insertInvestor(db, {
      name: "가이아벤처파트너스",
      normalized: "가이아벤처파트너스",
      source: "kvca",
      type: "VC/AC",
    });

    const results = searchInvestors(db, "가이아벤처파트너스");

    expect(results).toHaveLength(1);
    const [firm] = results;
    // 펀드 연결을 보유한 kvic 행이 canonical로 선정된다.
    expect(firm?.id).toBe(kvic);
    expect(firm?.source).toBe("kvic");
    expect(firm?.type).toBe("LLC");
    // 두 공시처가 모두 근거로 집계된다 (정렬된 배열).
    expect(firm?.sources).toEqual(["kvca", "kvic"]);
    expect(firm?.evidence_count).toBe(2);
  });

  test("펀드 연결이 없으면 구체 업종 유형 행을 canonical로 고른다", () => {
    insertInvestor(db, {
      name: "노틸러스인베스트먼트",
      normalized: "노틸러스인베스트먼트",
      source: "kvca",
      type: "VC/AC",
    });
    const kvic = insertInvestor(db, {
      name: "노틸러스인베스트먼트",
      normalized: "노틸러스인베스트먼트",
      source: "kvic",
      type: "벤처투자회사",
    });

    const [firm] = searchInvestors(db, "노틸러스");

    expect(firm?.id).toBe(kvic);
    expect(firm?.type).toBe("벤처투자회사");
    expect(firm?.evidence_count).toBe(2);
  });

  test("중복이 없는 단일 공시 회사는 그대로 반환된다", () => {
    insertInvestor(db, {
      name: "카카오벤처스",
      normalized: "카카오벤처스",
      source: "kvic",
      type: "벤처투자회사",
    });

    const results = searchInvestors(db, "카카오벤처스");

    expect(results).toHaveLength(1);
    expect(results[0]?.sources).toEqual(["kvic"]);
    expect(results[0]?.evidence_count).toBe(1);
  });

  test("limit은 롤업 이후의 회사 수 기준으로 적용된다", () => {
    // 서로 다른 회사 3곳, 각각 kvic+kvca 2행씩 = 6개 원본 행.
    for (const base of ["알파벤처스", "베타벤처스", "감마벤처스"]) {
      insertInvestor(db, { name: base, normalized: base, source: "kvic", type: "벤처투자회사" });
      insertInvestor(db, { name: base, normalized: base, source: "kvca", type: "VC/AC" });
    }

    const results = searchInvestors(db, "벤처스", 2);

    // 6개 행이 3개 회사로 병합된 뒤 limit 2가 적용된다.
    expect(results).toHaveLength(2);
    for (const firm of results) {
      expect(firm.evidence_count).toBe(2);
    }
  });

  test("결과가 없으면 빈 배열", () => {
    expect(searchInvestors(db, "존재하지않는투자사zzz")).toEqual([]);
  });
});
