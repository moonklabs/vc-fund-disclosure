import { watch, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, extname } from "node:path";
import type { Database } from "bun:sqlite";
import {
  importDisclosureDocument,
  importGuide,
  getPolicy,
  type AppPaths,
} from "@moonklabs/vc-fund-disclosure-core";

const SUPPORTED_EXTS = new Set([".pdf", ".hwpx", ".html", ".htm", ".csv", ".txt", ".md"]);
const SETTLE_MS = 800;

/**
 * Inbox(공시 문서)와 Guides(창업자 가이드)를 감시하여 자동 import한다.
 * Inbox 문서는 import 후 Archive/YYYY-MM/ 으로 이동한다.
 */
export function startWatch(db: Database, paths: AppPaths): void {
  const policy = getPolicy(db);
  if (!policy.watch_folder_import) {
    console.error("watch_folder_import 정책이 꺼져 있어 감시를 시작하지 않습니다.");
    process.exitCode = 1;
    return;
  }
  for (const dir of [paths.inbox, paths.guides, paths.archive]) {
    if (!existsSync(dir)) {
      console.error(`폴더가 없습니다: ${dir} — 먼저 'vc-funds setup'을 실행하세요.`);
      process.exitCode = 1;
      return;
    }
  }

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (filePath: string, action: () => Promise<void>): void => {
    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing);
    pending.set(
      filePath,
      setTimeout(() => {
        pending.delete(filePath);
        action().catch((error: unknown) => {
          console.error(`import 실패 (${filePath}): ${error instanceof Error ? error.message : String(error)}`);
        });
      }, SETTLE_MS),
    );
  };

  watch(paths.inbox, (_event, fileName) => {
    if (!fileName || !SUPPORTED_EXTS.has(extname(fileName).toLowerCase())) return;
    const filePath = join(paths.inbox, fileName);
    if (!existsSync(filePath)) return;
    schedule(filePath, async () => {
      const result = await importDisclosureDocument(db, { filePath, source: "manual" });
      const month = new Date().toISOString().slice(0, 7);
      const archiveDir = join(paths.archive, month);
      mkdirSync(archiveDir, { recursive: true });
      renameSync(filePath, join(archiveDir, fileName));
      console.error(
        `Inbox import 완료: ${fileName} → disclosure #${result.disclosureId} (${result.parseStatus}), Archive/${month}/로 이동`,
      );
    });
  });

  watch(paths.guides, (_event, fileName) => {
    if (!fileName || !SUPPORTED_EXTS.has(extname(fileName).toLowerCase())) return;
    const filePath = join(paths.guides, fileName);
    if (!existsSync(filePath)) return;
    schedule(filePath, async () => {
      const result = await importGuide(db, { filePath, role: "founder_education" });
      console.error(
        result.duplicated
          ? `Guide 이미 색인됨: ${fileName} (guide #${result.guideId})`
          : `Guide import 완료: ${fileName} → guide #${result.guideId} (청크 ${result.chunkCount}개)`,
      );
    });
  });

  console.error(`감시 시작:\n  Inbox : ${paths.inbox}\n  Guides: ${paths.guides}\n종료: Ctrl+C`);
}
