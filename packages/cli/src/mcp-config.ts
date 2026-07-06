import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MCP_SERVER_NAME = "vc-fund-disclosure";

export type RegisterStatus = "registered" | "already" | "not_ready";

export interface RegisterResult {
  client: "claude" | "codex";
  status: RegisterStatus;
  detail: string;
  configPath?: string;
  backupPath?: string;
}

interface McpServerEntry {
  type: "stdio";
  command: string;
  args: string[];
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function backupIfExists(configPath: string): string | undefined {
  if (!existsSync(configPath)) return undefined;
  const backupPath = `${configPath}.bak-${timestamp()}`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}

/**
 * Claude Code 사용자 설정(~/.claude.json)에 MCP 서버를 등록한다.
 * 실행 커맨드를 해석할 수 없으면 NOT_READY로 반환하고 설정을 건드리지 않는다.
 */
export function registerClaudeMcp(
  dbPath: string,
  command: string | null,
  home: string = homedir(),
): RegisterResult {
  if (!command) {
    return {
      client: "claude",
      status: "not_ready",
      detail:
        "vc-funds 실행 파일을 찾을 수 없어 MCP 설정을 등록하지 않았습니다. brew install 또는 bun run build 후 다시 실행하세요.",
    };
  }

  const configPath = join(home, ".claude.json");
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    } catch (error: unknown) {
      return {
        client: "claude",
        status: "not_ready",
        detail: `~/.claude.json 파싱 실패 — 손상 방지를 위해 수정하지 않았습니다: ${error instanceof Error ? error.message : String(error)}`,
        configPath,
      };
    }
  }

  const servers = { ...((config.mcpServers as Record<string, unknown> | undefined) ?? {}) };
  if (servers[MCP_SERVER_NAME]) {
    return { client: "claude", status: "already", detail: "이미 등록되어 있습니다.", configPath };
  }

  const entry: McpServerEntry = {
    type: "stdio",
    command,
    args: ["mcp", "serve", "--db", dbPath],
  };
  const nextConfig = { ...config, mcpServers: { ...servers, [MCP_SERVER_NAME]: entry } };

  const backupPath = backupIfExists(configPath);
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return {
    client: "claude",
    status: "registered",
    detail: `~/.claude.json에 ${MCP_SERVER_NAME} 등록 완료`,
    configPath,
    backupPath,
  };
}

/**
 * Codex CLI 설정(~/.codex/config.toml)에 MCP 서버를 등록한다.
 * 기존 TOML 구조를 보존하기 위해 섹션 append 방식만 사용한다.
 */
export function registerCodexMcp(
  dbPath: string,
  command: string | null,
  home: string = homedir(),
): RegisterResult {
  if (!command) {
    return {
      client: "codex",
      status: "not_ready",
      detail: "vc-funds 실행 파일을 찾을 수 없어 MCP 설정을 등록하지 않았습니다.",
    };
  }

  const configPath = join(home, ".codex", "config.toml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  if (existing.includes(`[mcp_servers.${MCP_SERVER_NAME}]`)) {
    return { client: "codex", status: "already", detail: "이미 등록되어 있습니다.", configPath };
  }

  const section = [
    "",
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${JSON.stringify(command)}`,
    `args = ["mcp", "serve", "--db", ${JSON.stringify(dbPath)}]`,
    "",
  ].join("\n");

  mkdirSync(dirname(configPath), { recursive: true });
  const backupPath = backupIfExists(configPath);
  writeFileSync(configPath, existing + section);
  return {
    client: "codex",
    status: "registered",
    detail: `~/.codex/config.toml에 ${MCP_SERVER_NAME} 등록 완료`,
    configPath,
    backupPath,
  };
}

/** doctor용: 클라이언트 설정에 MCP 서버가 등록되어 있는지 확인. */
export function isRegistered(client: "claude" | "codex", home: string = homedir()): boolean {
  if (client === "claude") {
    const configPath = join(home, ".claude.json");
    if (!existsSync(configPath)) return false;
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
        mcpServers?: Record<string, unknown>;
      };
      return Boolean(config.mcpServers?.[MCP_SERVER_NAME]);
    } catch {
      return false;
    }
  }
  const configPath = join(home, ".codex", "config.toml");
  return existsSync(configPath) && readFileSync(configPath, "utf-8").includes(`[mcp_servers.${MCP_SERVER_NAME}]`);
}
