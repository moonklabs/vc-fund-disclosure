import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/database.ts";
import { importSeedData, SEED_DATASET } from "../src/import/seed.ts";
import { searchInvestors } from "../src/search.ts";

describe("importSeedData", () => {
  test("번들 시드 CSV를 Archive에 기록하고 운용사를 적재한다", () => {
    const db = openDatabase(":memory:");
    const archiveDir = mkdtempSync(join(tmpdir(), "vc-seed-"));

    const { filePath, result } = importSeedData(db, { archiveDir });
    expect(existsSync(filePath)).toBe(true);
    expect(filePath.endsWith(SEED_DATASET.fileName)).toBe(true);
    expect(result.duplicated).toBe(false);
    // 1,411행 전체가 investors upsert 대상 (고유 327개로 병합)
    expect(result.rawRowCount).toBe(1411);
    expect(result.imported.investors).toBe(1411);
    expect(result.imported.funds).toBe(0);

    // 원문 고유 327개 중 "(말소_창투사)이앤인베스트먼트"가 괄호 제거 정규화로
    // "이앤인베스트먼트"에 병합되어 326개가 된다.
    const unique = db
      .query<{ n: number }, []>("SELECT count(*) AS n FROM investors")
      .get();
    expect(unique?.n).toBe(326);

    // 운영사구분이 investor type으로 반영된다
    const stick = searchInvestors(db, "스틱벤처스");
    expect(stick).toHaveLength(1);
    const type = db
      .query<{ type: string }, [string]>("SELECT type FROM investors WHERE name = ?")
      .get("스틱벤처스");
    expect(type?.type).toBe("벤처투자회사");
  });

  test("재실행은 sha256 중복으로 no-op", () => {
    const db = openDatabase(":memory:");
    const archiveDir = mkdtempSync(join(tmpdir(), "vc-seed-"));
    importSeedData(db, { archiveDir });
    const second = importSeedData(db, { archiveDir });
    expect(second.result.duplicated).toBe(true);
  });

  test("KVIC 스냅샷의 investor type 기본값은 유지된다 (COALESCE)", () => {
    const db = openDatabase(":memory:");
    const archiveDir = mkdtempSync(join(tmpdir(), "vc-seed-"));
    importSeedData(db, { archiveDir });
    // 시드로 type이 채워진 운용사는 이후 type 없는 스냅샷 import에도 유지되어야 한다
    const before = db
      .query<{ type: string }, [string]>("SELECT type FROM investors WHERE name = ?")
      .get("스틱벤처스");
    expect(before?.type).toBe("벤처투자회사");
  });
});
