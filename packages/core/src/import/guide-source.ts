import type { Database } from "bun:sqlite";

export type GuideAccessStatus = "ok" | "remote_gone_410" | "forbidden" | "unknown";

export interface GuideSourceInput {
  url: string;
  publisher?: string;
  role?: string;
  accessStatus?: GuideAccessStatus;
}

export interface GuideSourceRow {
  id: number;
  publisher: string | null;
  url: string;
  role: string | null;
  access_status: string;
  checked_at: string | null;
  created_at: string;
}

/**
 * 원격 URL 후보를 등록한다 (실제 파일 import와 분리).
 * 이미 등록된 URL이면 access_status만 갱신한다.
 */
export function addGuideSource(db: Database, input: GuideSourceInput): GuideSourceRow {
  const row = db
    .query<GuideSourceRow, [string | null, string, string | null, string]>(
      `INSERT INTO guide_sources (publisher, url, role, access_status, checked_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(url) DO UPDATE SET
         access_status = excluded.access_status,
         checked_at = excluded.checked_at
       RETURNING *`,
    )
    .get(input.publisher ?? null, input.url, input.role ?? null, input.accessStatus ?? "unknown");
  if (!row) throw new Error("guide source 저장에 실패했습니다.");
  return row;
}

export function listGuideSources(db: Database): GuideSourceRow[] {
  return db.query<GuideSourceRow, []>("SELECT * FROM guide_sources ORDER BY created_at DESC").all();
}
