import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { sha256Hex } from "../hash.ts";
import { detectKind, extractDocumentText } from "../parse/document.ts";

export interface DocumentImportInput {
  filePath: string;
  source: "kvic" | "kvca" | "tips" | "manual";
}

export interface DocumentImportResult {
  disclosureId: number;
  duplicated: boolean;
  kind: string;
  parseStatus: "parsed" | "failed";
}

/**
 * 공시 문서(PDF/HWPX/HTML/CSV 등)를 disclosures에 적재한다.
 * 텍스트 추출에 실패해도 원본 기록은 남긴다 (parse_status='failed').
 */
export async function importDisclosureDocument(
  db: Database,
  input: DocumentImportInput,
): Promise<DocumentImportResult> {
  const buffer = new Uint8Array(readFileSync(input.filePath));
  const hash = sha256Hex(buffer);

  const existing = db
    .query<{ id: number; kind: string }, [string]>("SELECT id, kind FROM disclosures WHERE sha256 = ?")
    .get(hash);
  if (existing) {
    return { disclosureId: existing.id, duplicated: true, kind: existing.kind, parseStatus: "parsed" };
  }

  const kind = detectKind(input.filePath);
  let text: string | null = null;
  let parseError: string | null = null;
  try {
    text = await extractDocumentText(kind, buffer);
  } catch (error: unknown) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const parseStatus: "parsed" | "failed" = text !== null ? "parsed" : "failed";
  const meta = { fileName: basename(input.filePath), text, parseError };

  const inserted = db
    .query<{ id: number }, [string, string, string, string, string, string]>(
      `INSERT INTO disclosures (source, kind, file_path, sha256, parse_status, meta_json)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(input.source, kind, input.filePath, hash, parseStatus, JSON.stringify(meta));

  if (!inserted) {
    throw new Error("disclosure 저장에 실패했습니다.");
  }

  db.query(
    `INSERT INTO events (disclosure_id, event_type, entity, summary)
     VALUES (?, 'document_imported', ?, ?)`,
  ).run(
    inserted.id,
    input.source,
    `${input.source.toUpperCase()} 문서 import: ${basename(input.filePath)} (${kind}, ${parseStatus})`,
  );

  return { disclosureId: inserted.id, duplicated: false, kind, parseStatus };
}
