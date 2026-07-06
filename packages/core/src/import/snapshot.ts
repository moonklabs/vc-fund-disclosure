import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { sha256Hex } from "../hash.ts";
import { parseHtmlSnapshot } from "../parse/html.ts";
import { recordsFromCsv, recordsFromTables, type SnapshotRows } from "../parse/rows.ts";
import { normalizeSnapshotRow } from "../normalize/fields.ts";
import { upsertSnapshotEntities, type EntityImportCounters } from "./entities.ts";

export interface SnapshotImportInput {
  filePath: string;
  source: "kvic" | "kvca" | "tips" | "manual";
  /** KVIC FundFinder 그룹 코드 (예: AA) */
  group?: string;
  /** KVIC FundFinder 상세 코드 (예: AA02) */
  code?: string;
  /** 스냅샷 캡처 시각 (기본: 현재) */
  capturedAt?: string;
}

export interface SnapshotImportResult {
  disclosureId: number;
  duplicated: boolean;
  tableCount: number;
  rawRowCount: number;
  normalizedRowCount: number;
  warnings: string[];
  imported: EntityImportCounters;
}

const EMPTY_COUNTERS: EntityImportCounters = {
  funds: 0,
  newFunds: 0,
  investors: 0,
  operatorLinks: 0,
  focusRows: 0,
  qualityFlags: 0,
};

/**
 * 사용자가 저장한 KVIC/KVCA HTML 또는 CSV 스냅샷을 import한다.
 * - sha256으로 중복 import를 방지한다 (원본 보존).
 * - v2: 테이블 행을 한국어 별칭 사전으로 정규화해
 *   investors/funds/fund_operator_links/fund_investment_focus까지 적재하고,
 *   신규 펀드에는 new_fund 이벤트를 남긴다.
 */
export function importHtmlSnapshot(db: Database, input: SnapshotImportInput): SnapshotImportResult {
  const buffer = readFileSync(input.filePath);
  const hash = sha256Hex(new Uint8Array(buffer));

  const existing = db
    .query<{ id: number }, [string]>("SELECT id FROM disclosures WHERE sha256 = ?")
    .get(hash);
  if (existing) {
    return {
      disclosureId: existing.id,
      duplicated: true,
      tableCount: 0,
      rawRowCount: 0,
      normalizedRowCount: 0,
      warnings: [],
      imported: { ...EMPTY_COUNTERS },
    };
  }

  const ext = extname(input.filePath).toLowerCase();
  const text = buffer.toString("utf-8");

  let title: string | null = null;
  let tableCount = 0;
  let records: SnapshotRows;
  let kind: "html_snapshot" | "csv";
  if (ext === ".csv") {
    kind = "csv";
    records = recordsFromCsv(text);
  } else {
    kind = "html_snapshot";
    const snapshot = parseHtmlSnapshot(text);
    title = snapshot.title;
    tableCount = snapshot.tables.length;
    records = recordsFromTables(snapshot.tables);
  }

  const normalizedRows = records.rows.map((row, index) =>
    normalizeSnapshotRow(row, { source: input.source, rowIndex: index + 1 }),
  );
  const validRowCount = normalizedRows.filter((row) => row.fundName).length;
  const warnings = [...records.warnings, ...normalizedRows.flatMap((row) => row.warnings)];
  const parseStatus = validRowCount > 0 ? "parsed" : "raw";

  const meta = {
    title,
    group: input.group ?? null,
    code: input.code ?? null,
    tableCount,
    headers: records.headers,
    rawRowCount: records.rows.length,
    normalizedRowCount: validRowCount,
  };

  const inserted = db
    .query<{ id: number }, [string, string, string, string, string, string]>(
      `INSERT INTO disclosures (source, kind, file_path, sha256, parse_status, meta_json)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(input.source, kind, input.filePath, hash, parseStatus, JSON.stringify(meta));
  if (!inserted) {
    throw new Error("disclosure 저장에 실패했습니다.");
  }

  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const imported = upsertSnapshotEntities(db, normalizedRows, {
    source: input.source,
    disclosureId: inserted.id,
    capturedAt,
  });

  db.query(
    `INSERT INTO events (disclosure_id, event_type, entity, summary)
     VALUES (?, 'snapshot_imported', ?, ?)`,
  ).run(
    inserted.id,
    input.code ?? input.source,
    `${input.source.toUpperCase()} 스냅샷 import: ${title ?? basename(input.filePath)} (행 ${records.rows.length}개 중 ${validRowCount}개 정규화, 신규 펀드 ${imported.newFunds}개)`,
  );

  return {
    disclosureId: inserted.id,
    duplicated: false,
    tableCount,
    rawRowCount: records.rows.length,
    normalizedRowCount: validRowCount,
    warnings,
    imported,
  };
}
