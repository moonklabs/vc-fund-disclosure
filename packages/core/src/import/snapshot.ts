import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { sha256Hex } from "../hash.ts";
import { parseHtmlSnapshot } from "../parse/html.ts";

export interface SnapshotImportInput {
  filePath: string;
  source: "kvic" | "kvca" | "tips" | "manual";
  /** KVIC FundFinder 그룹 코드 (예: AA) */
  group?: string;
  /** KVIC FundFinder 상세 코드 (예: AA02) */
  code?: string;
}

export interface SnapshotImportResult {
  disclosureId: number;
  duplicated: boolean;
  tableCount: number;
}

/**
 * 사용자가 저장한 HTML 스냅샷을 disclosures에 적재한다.
 * - sha256으로 중복 import를 방지한다.
 * - v0.1은 원본 보존 + 테이블 원시 추출까지만 수행한다 (parse_status='raw').
 *   KVIC/KVCA 컬럼 → funds/investors 정규화 매핑은 로드맵 항목.
 */
export function importHtmlSnapshot(db: Database, input: SnapshotImportInput): SnapshotImportResult {
  const buffer = readFileSync(input.filePath);
  const hash = sha256Hex(new Uint8Array(buffer));

  const existing = db
    .query<{ id: number }, [string]>("SELECT id FROM disclosures WHERE sha256 = ?")
    .get(hash);
  if (existing) {
    return { disclosureId: existing.id, duplicated: true, tableCount: 0 };
  }

  const snapshot = parseHtmlSnapshot(buffer.toString("utf-8"));
  const meta = {
    title: snapshot.title,
    group: input.group ?? null,
    code: input.code ?? null,
    tableCount: snapshot.tables.length,
    tables: snapshot.tables,
  };

  const inserted = db
    .query<{ id: number }, [string, string, string, string]>(
      `INSERT INTO disclosures (source, kind, file_path, sha256, meta_json)
       VALUES (?, 'html_snapshot', ?, ?, ?) RETURNING id`,
    )
    .get(input.source, input.filePath, hash, JSON.stringify(meta));

  if (!inserted) {
    throw new Error("disclosure 저장에 실패했습니다.");
  }

  db.query(
    `INSERT INTO events (disclosure_id, event_type, entity, summary)
     VALUES (?, 'snapshot_imported', ?, ?)`,
  ).run(
    inserted.id,
    input.code ?? input.source,
    `${input.source.toUpperCase()} 스냅샷 import: ${snapshot.title ?? basename(input.filePath)} (테이블 ${snapshot.tables.length}개)`,
  );

  return { disclosureId: inserted.id, duplicated: false, tableCount: snapshot.tables.length };
}
