import { mkdirSync } from "node:fs";
import { openDatabase, type AppPaths } from "@moonklabs/vc-fund-disclosure-core";
import { registerClaudeMcp, registerCodexMcp, type RegisterResult } from "../mcp-config.ts";
import { resolveExecutableCommand } from "../resolve.ts";
import { runDoctorChecks, formatDoctorReport } from "../doctor-checks.ts";

export type SetupClient = "claude" | "codex" | "both" | "none";

export interface SetupOptions {
  client: SetupClient;
  /** MCP 설정에 기록할 실행 커맨드 override */
  command?: string;
}

/**
 * setup contract 7단계:
 * DB 생성 → 보관함 → guide library → watch folder(Inbox) → MCP 설정 → 백업 → doctor
 */
export function runSetup(paths: AppPaths, options: SetupOptions): number {
  const out = console.error.bind(console);

  out(`[1/7] 로컬 SQLite DB 생성: ${paths.db}`);
  openDatabase(paths.db).close();

  out(`[2/7] 기본 보관함 생성: ${paths.archive}`);
  mkdirSync(paths.archive, { recursive: true });

  out(`[3/7] 창업자 guide library 생성: ${paths.guides}`);
  mkdirSync(paths.guides, { recursive: true });

  out(`[4/7] watch folder(Inbox) 생성: ${paths.inbox}`);
  mkdirSync(paths.inbox, { recursive: true });
  out("      (자동 감시는 'vc-funds watch'로 시작합니다)");

  out("[5/7] MCP 클라이언트 설정 등록");
  const command = options.command ?? resolveExecutableCommand();
  const results: RegisterResult[] = [];
  if (options.client === "claude" || options.client === "both") {
    results.push(registerClaudeMcp(paths.db, command));
  }
  if (options.client === "codex" || options.client === "both") {
    results.push(registerCodexMcp(paths.db, command));
  }
  if (options.client === "none") {
    out("      --client none: MCP 설정 등록을 건너뜁니다.");
  }
  for (const result of results) {
    out(`      [${result.client}] ${result.status.toUpperCase()}: ${result.detail}`);
  }

  out("[6/7] 설정 백업");
  const backups = results.filter((r) => r.backupPath).map((r) => r.backupPath as string);
  out(backups.length > 0 ? `      백업 생성: ${backups.join(", ")}` : "      백업 대상 변경 없음");

  out("[7/7] doctor 실행");
  const checks = runDoctorChecks(paths);
  console.log(formatDoctorReport(checks));

  const hasNotReady = results.some((r) => r.status === "not_ready");
  return hasNotReady ? 1 : 0;
}
