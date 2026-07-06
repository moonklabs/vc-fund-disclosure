import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase } from "../src/db/database.ts";
import { importHtmlSnapshot } from "../src/import/snapshot.ts";
import { searchFunds, searchInvestors, listEvents, getDbStatus } from "../src/search.ts";

const KVIC_HTML = `<html><head><title>KVIC FundFinder - AA02</title></head><body>
<table>
<tr><th>펀드명</th><th>운용사</th><th>결성일</th><th>결성총액(억원)</th><th>투자분야</th><th>투자단계</th></tr>
<tr><td>청년창업펀드1호</td><td>프라이머</td><td>2024.01.15</td><td>300억</td><td>AI</td><td>시드</td></tr>
<tr><td>미래성장펀드2호</td><td>블루포인트 및 한국투자파트너스</td><td>2023.06.01</td><td>1,000억</td><td>딥테크</td><td>프리A</td></tr>
<tr><td>불량행펀드</td><td>매드업</td><td>미정</td><td>비공개</td><td></td><td></td></tr>
</table></body></html>`;

const KVCA_CSV = [
  "조합명,업무집행조합원,등록일,결성총액,대표펀드매니저",
  "예시벤처조합 1호,예시파트너스,2024년 2월 1일,\"500억\",김철수",
  "청년창업펀드1호,프라이머,2024년 1월 20일,300억,이영희",
].join("\n");

function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "vcf-snap-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, content);
  return filePath;
}

describe("importHtmlSnapshot v2 정규화", () => {
  test("KVIC HTML에서 funds/investors/links를 적재하고 new_fund 이벤트를 남긴다", () => {
    const db = openDatabase(":memory:");
    const result = importHtmlSnapshot(db, {
      filePath: tempFile("kvic.html", KVIC_HTML),
      source: "kvic",
      group: "AA",
      code: "AA02",
    });

    expect(result.rawRowCount).toBe(3);
    expect(result.normalizedRowCount).toBe(3);
    expect(result.imported.funds).toBe(3);
    expect(result.imported.newFunds).toBe(3);
    expect(result.imported.investors).toBe(4); // 프라이머, 블루포인트, 한국투자파트너스, 매드업
    expect(result.imported.operatorLinks).toBe(4);
    expect(result.warnings.some((w) => w.includes("금액 파싱 실패"))).toBe(true);

    const funds = searchFunds(db, "미래성장");
    expect(funds).toHaveLength(1);
    expect(funds[0]?.investor_name).toContain("블루포인트");
    expect(funds[0]?.investor_name).toContain("한국투자파트너스");
    expect(funds[0]?.committed_amount_krw).toBe(100_000_000_000);

    const byInvestor = searchFunds(db, "프라이머");
    expect(byInvestor.map((f) => f.name)).toContain("청년창업펀드1호");

    expect(searchInvestors(db, "프라이머").length).toBe(1);

    const events = listEvents(db);
    expect(events.filter((e) => e.event_type === "new_fund")).toHaveLength(3);
    expect(events.filter((e) => e.event_type === "snapshot_imported")).toHaveLength(1);

    expect(getDbStatus(db).dataQualityFlags).toBeGreaterThan(0);
  });

  test("같은 내용 재import는 sha256으로 차단되고, 다른 스냅샷 재출현은 신규 이벤트를 만들지 않는다", () => {
    const db = openDatabase(":memory:");
    const first = importHtmlSnapshot(db, {
      filePath: tempFile("kvic.html", KVIC_HTML),
      source: "kvic",
    });
    expect(first.duplicated).toBe(false);

    const duplicate = importHtmlSnapshot(db, {
      filePath: tempFile("kvic-again.html", KVIC_HTML),
      source: "kvic",
    });
    expect(duplicate.duplicated).toBe(true);

    // 공백만 달라진 새 스냅샷 → 기존 펀드는 upsert, new_fund 이벤트 없음
    const changed = importHtmlSnapshot(db, {
      filePath: tempFile("kvic-v2.html", `${KVIC_HTML}\n<!-- v2 -->`),
      source: "kvic",
    });
    expect(changed.duplicated).toBe(false);
    expect(changed.imported.newFunds).toBe(0);
    expect(getDbStatus(db).funds).toBe(3);
  });

  test("KVCA CSV를 정규화하고 소스별로 엔티티를 구분한다", () => {
    const db = openDatabase(":memory:");
    importHtmlSnapshot(db, { filePath: tempFile("kvic.html", KVIC_HTML), source: "kvic" });
    const result = importHtmlSnapshot(db, {
      filePath: tempFile("kvca.csv", KVCA_CSV),
      source: "kvca",
    });

    expect(result.normalizedRowCount).toBe(2);
    expect(result.imported.funds).toBe(2);

    const funds = searchFunds(db, "예시벤처조합");
    expect(funds).toHaveLength(1);
    expect(funds[0]?.committed_amount_krw).toBe(50_000_000_000);
    expect(funds[0]?.investor_name).toBe("예시파트너스");
  });
});

describe("스키마 v1 → v2 마이그레이션", () => {
  test("v1 DB를 열면 v2 컬럼/테이블이 추가되고 데이터가 보존된다", () => {
    const dir = mkdtempSync(join(tmpdir(), "vcf-migrate-"));
    const dbPath = join(dir, "v1.sqlite");

    // v1 스키마를 수동 구성 (v1 당시 funds/investors 컬럼만)
    const v1 = new Database(dbPath, { create: true });
    v1.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');
      CREATE TABLE investors (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_normalized TEXT NOT NULL,
        type TEXT, source TEXT NOT NULL, registered_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(name_normalized, source)
      );
      CREATE TABLE funds (
        id INTEGER PRIMARY KEY, investor_id INTEGER REFERENCES investors(id),
        name TEXT NOT NULL, code TEXT, vintage TEXT, size_krw INTEGER, status TEXT,
        source TEXT NOT NULL, disclosed_at TEXT, raw_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO investors (name, name_normalized, source) VALUES ('프라이머', '프라이머', 'kvic');
      INSERT INTO funds (name, source) VALUES ('기존펀드1호', 'kvic');
    `);
    v1.close();

    const db = openDatabase(dbPath);
    const version = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key='schema_version'").get();
    expect(version?.value).toBe("2");

    // v2 컬럼에 쓰기 가능
    db.query("UPDATE funds SET name_normalized = '기존펀드1호', committed_amount_krw = 100 WHERE name = '기존펀드1호'").run();
    // v2 신규 테이블 존재
    expect(getDbStatus(db).fundOperatorLinks).toBe(0);
    // 기존 데이터 보존
    expect(searchInvestors(db, "프라이머")).toHaveLength(1);
  });
});
