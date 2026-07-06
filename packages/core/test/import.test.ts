import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/database.ts";
import { importGuide } from "../src/import/guide.ts";
import { importHtmlSnapshot } from "../src/import/snapshot.ts";
import { addGuideSource, listGuideSources } from "../src/import/guide-source.ts";
import { searchGuides, listEvents, getDbStatus } from "../src/search.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "vc-funds-test-"));
}

describe("importGuide + searchGuides", () => {
  test("텍스트 가이드를 색인하고 FTS로 검색한다", async () => {
    const db = openDatabase(":memory:");
    const dir = tempDir();
    const filePath = join(dir, "seed-guide.md");
    writeFileSync(
      filePath,
      "# 시드 투자유치 가이드\n\n처음 투자유치할 때는 문제 정의와 트랙션 정리부터 시작합니다.\n\n데이터룸에는 재무제표와 주주명부를 준비합니다.",
    );

    const result = await importGuide(db, {
      filePath,
      role: "founder_education",
      publisher: "KVIC",
    });
    expect(result.duplicated).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(0);

    const hits = searchGuides(db, "데이터룸");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.publisher).toBe("KVIC");
    expect(hits[0]?.content).toContain("데이터룸");
  });

  test("자연어 질문(다중 단어)도 토큰 OR 검색으로 매칭된다", async () => {
    const db = openDatabase(":memory:");
    const dir = tempDir();
    const filePath = join(dir, "q-guide.md");
    writeFileSync(filePath, "데이터룸에는 재무제표와 주주명부를 준비합니다.");
    await importGuide(db, { filePath, role: "dataroom" });

    const hits = searchGuides(db, "데이터룸에 무엇을 준비해야 해?");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.content).toContain("재무제표");
  });

  test("같은 파일은 중복 import되지 않는다", async () => {
    const db = openDatabase(":memory:");
    const dir = tempDir();
    const filePath = join(dir, "dup-guide.txt");
    writeFileSync(filePath, "투자계약서 검토 시 우선주 조항을 확인합니다.");

    const first = await importGuide(db, { filePath, role: "term_sheet" });
    const second = await importGuide(db, { filePath, role: "term_sheet" });
    expect(second.duplicated).toBe(true);
    expect(second.guideId).toBe(first.guideId);
    expect(getDbStatus(db).guides).toBe(1);
  });
});

describe("importHtmlSnapshot", () => {
  test("HTML 스냅샷을 저장하고 이벤트를 남긴다", () => {
    const db = openDatabase(":memory:");
    const dir = tempDir();
    const filePath = join(dir, "fundfinder-AA02.html");
    writeFileSync(
      filePath,
      `<html><head><title>KVIC FundFinder</title></head><body>
        <table><tr><th>펀드명</th><th>운용사</th></tr><tr><td>청년창업펀드1호</td><td>프라이머</td></tr></table>
      </body></html>`,
    );

    const result = importHtmlSnapshot(db, {
      filePath,
      source: "kvic",
      group: "AA",
      code: "AA02",
    });
    expect(result.duplicated).toBe(false);
    expect(result.tableCount).toBe(1);

    const events = listEvents(db);
    const imported = events.find((e) => e.event_type === "snapshot_imported");
    expect(imported?.summary).toContain("KVIC");
    // v2: 정규화된 신규 펀드에 new_fund 이벤트가 함께 생성된다
    expect(events.some((e) => e.event_type === "new_fund")).toBe(true);
  });
});

describe("guide sources", () => {
  test("URL 후보 등록과 access_status 갱신", () => {
    const db = openDatabase(":memory:");
    const url = "https://www.kvic.or.kr/upload/investment/20210114/20210114155945_63291.pdf";

    addGuideSource(db, { url, publisher: "KVIC", accessStatus: "unknown" });
    const updated = addGuideSource(db, { url, publisher: "KVIC", accessStatus: "remote_gone_410" });

    expect(updated.access_status).toBe("remote_gone_410");
    expect(listGuideSources(db)).toHaveLength(1);
  });
});
