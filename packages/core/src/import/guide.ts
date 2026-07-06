import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { sha256Hex } from "../hash.ts";
import { chunkText } from "../chunk/chunker.ts";
import { detectKind, extractDocumentText } from "../parse/document.ts";

export type GuideRole = "founder_education" | "tips" | "ir" | "dataroom" | "term_sheet";

export interface GuideImportInput {
  filePath: string;
  role: GuideRole;
  publisher?: string;
  sourceUrl?: string;
  title?: string;
}

export interface GuideImportResult {
  guideId: number;
  duplicated: boolean;
  chunkCount: number;
}

/**
 * 창업자 가이드(PDF/HWPX/텍스트)를 import하여 청크 단위로 FTS 색인한다.
 */
export async function importGuide(db: Database, input: GuideImportInput): Promise<GuideImportResult> {
  const buffer = new Uint8Array(readFileSync(input.filePath));
  const hash = sha256Hex(buffer);

  const existing = db
    .query<{ id: number; count: number }, [string]>(
      `SELECT g.id, (SELECT COUNT(*) FROM guide_chunks c WHERE c.guide_id = g.id) AS count
       FROM guides g WHERE g.sha256 = ?`,
    )
    .get(hash);
  if (existing) {
    return { guideId: existing.id, duplicated: true, chunkCount: existing.count };
  }

  const kind = detectKind(input.filePath);
  const text = await extractDocumentText(kind, buffer);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error("가이드 본문이 비어 있어 import할 수 없습니다.");
  }

  const title = input.title ?? basename(input.filePath).replace(/\.[^.]+$/, "");

  const insertGuide = db.query<{ id: number }, [string, string | null, string, string, string | null, string]>(
    `INSERT INTO guides (title, publisher, role, file_path, source_url, sha256)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertChunk = db.query(
    "INSERT INTO guide_chunks (guide_id, seq, content) VALUES (?, ?, ?)",
  );

  const run = db.transaction(() => {
    const guide = insertGuide.get(
      title,
      input.publisher ?? null,
      input.role,
      input.filePath,
      input.sourceUrl ?? null,
      hash,
    );
    if (!guide) throw new Error("guide 저장에 실패했습니다.");
    chunks.forEach((content, index) => {
      insertChunk.run(guide.id, index, content);
    });
    return guide.id;
  });

  const guideId = run();
  return { guideId, duplicated: false, chunkCount: chunks.length };
}
