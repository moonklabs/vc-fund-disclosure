import { existsSync } from "node:fs";
import {
  VERSION,
  openDatabase,
  setMeta,
  getPolicy,
  isPolicyCompliant,
  type AppPaths,
} from "@moonklabs/vc-fund-disclosure-core";
import { isRegistered } from "./mcp-config.ts";
import { resolveExecutableCommand } from "./resolve.ts";

export type CheckStatus = "OK" | "WARN" | "BLOCKED";

export interface DoctorCheck {
  item: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorOptions {
  home?: string;
  /** 테스트에서 설정 파일 검사를 건너뛰기 위한 플래그 */
  skipClientConfig?: boolean;
}

export function runDoctorChecks(paths: AppPaths, options: DoctorOptions = {}): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const command = resolveExecutableCommand();
  checks.push(
    command
      ? { item: "CLI 실행", status: "OK", detail: `vc-funds v${VERSION} (${command})` }
      : {
          item: "CLI 실행",
          status: "WARN",
          detail: `개발 모드(bun) 실행 중 — PATH에 vc-funds 바이너리 없음 (v${VERSION})`,
        },
  );

  try {
    const db = openDatabase(paths.db);
    setMeta(db, "doctor_probe", new Date().toISOString());
    const policy = getPolicy(db);
    db.close();
    checks.push({ item: "DB 접근", status: "OK", detail: paths.db });
    checks.push(
      isPolicyCompliant(policy)
        ? { item: "정책", status: "OK", detail: "무허가 crawler 비활성화 상태" }
        : { item: "정책", status: "BLOCKED", detail: "site_background_crawler가 활성화되어 있습니다" },
    );
  } catch (error: unknown) {
    checks.push({
      item: "DB 접근",
      status: "BLOCKED",
      detail: `SQLite 생성/쓰기 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
    checks.push({ item: "정책", status: "WARN", detail: "DB에 접근할 수 없어 확인 불가" });
  }

  checks.push(
    existsSync(paths.inbox)
      ? { item: "Inbox", status: "OK", detail: paths.inbox }
      : { item: "Inbox", status: "WARN", detail: `없음 — vc-funds setup으로 생성: ${paths.inbox}` },
  );
  checks.push(
    existsSync(paths.guides)
      ? { item: "Guide Library", status: "OK", detail: paths.guides }
      : { item: "Guide Library", status: "WARN", detail: `없음 — vc-funds setup으로 생성: ${paths.guides}` },
  );

  if (!options.skipClientConfig) {
    const claudeOk = isRegistered("claude", options.home);
    const codexOk = isRegistered("codex", options.home);
    const registered = [claudeOk && "claude", codexOk && "codex"].filter(Boolean).join(", ");
    checks.push(
      claudeOk || codexOk
        ? { item: "MCP 설정", status: "OK", detail: `등록됨: ${registered}` }
        : { item: "MCP 설정", status: "WARN", detail: "NOT_READY — 어느 클라이언트에도 등록되지 않음" },
    );
  }

  checks.push(
    command
      ? { item: "MCP 실행", status: "OK", detail: "stdio server 실행 파일 확인됨 (handshake 자동검사는 로드맵)" }
      : { item: "MCP 실행", status: "WARN", detail: "실행 파일 미확인 — 빌드/설치 후 재확인 필요" },
  );

  return checks;
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const lines = [
    "# VC Funds Local MCP Doctor",
    "",
    "| 항목 | 상태 | 설명 |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.item} | ${c.status} | ${c.detail} |`),
  ];
  return lines.join("\n");
}

export function worstStatus(checks: DoctorCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "BLOCKED")) return "BLOCKED";
  if (checks.some((c) => c.status === "WARN")) return "WARN";
  return "OK";
}
