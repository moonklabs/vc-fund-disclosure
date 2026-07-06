import { basename } from "node:path";
import { defaultPaths, type AppPaths } from "@moonklabs/vc-fund-disclosure-core";

export interface GlobalCliOptions {
  db?: string;
  disclosureDir?: string;
}

export function resolveAppPaths(options: GlobalCliOptions): AppPaths {
  return defaultPaths({ db: options.db, disclosureRoot: options.disclosureDir });
}

/**
 * MCP 설정에 등록할 실행 커맨드를 결정한다.
 * - 컴파일된 단일 바이너리로 실행 중이면 자기 자신의 절대 경로
 * - 아니면 PATH의 vc-funds
 * - 둘 다 아니면 null (NOT_READY — 설정에 등록하지 않는다)
 */
export function resolveExecutableCommand(): string | null {
  const exe = process.execPath;
  if (basename(exe).startsWith("vc-funds")) return exe;
  return Bun.which("vc-funds");
}
