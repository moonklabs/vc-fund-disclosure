import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importHtmlSnapshot, type SnapshotImportResult } from "./snapshot.ts";
// Bun 컴파일 시 바이너리에 임베드된다 (오프라인 시드).
import seedCsv from "../../data/datago-kvic-mofund-operators-20251212.csv" with { type: "text" };

/**
 * 번들 시드 데이터: 한국벤처투자_모태펀드 자조합 운용사정보 (data.go.kr 공공 개방, 이용허락범위 제한 없음).
 * 출처·라이선스: packages/core/data/README.md
 */
export const SEED_DATASET = Object.freeze({
  fileName: "datago-kvic-mofund-operators-20251212.csv",
  title: "한국벤처투자_모태펀드 자조합 운용사정보_20251212",
  sourceUrl: "https://www.data.go.kr/data/3060708/fileData.do",
  license: "이용허락범위 제한 없음 (공공데이터포털)",
  publishedAt: "2025-12-15",
});

export interface SeedImportInput {
  /** 원본 CSV 사본을 보관할 디렉토리 (Archive) */
  archiveDir: string;
}

export interface SeedImportResult {
  filePath: string;
  result: SnapshotImportResult;
}

/**
 * 임베드된 시드 CSV를 Archive에 기록하고 기존 스냅샷 파이프라인으로 import한다.
 * 네트워크 접근 없음. 재실행 시 sha256 중복으로 no-op.
 */
export function importSeedData(db: Database, input: SeedImportInput): SeedImportResult {
  mkdirSync(input.archiveDir, { recursive: true });
  const filePath = join(input.archiveDir, SEED_DATASET.fileName);
  writeFileSync(filePath, seedCsv);
  const result = importHtmlSnapshot(db, {
    filePath,
    source: "kvic",
    capturedAt: `${SEED_DATASET.publishedAt}T00:00:00.000Z`,
    sourceUrl: SEED_DATASET.sourceUrl,
  });
  return { filePath, result };
}
