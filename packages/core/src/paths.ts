import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  /** SQLite DB 파일 경로 */
  db: string;
  /** 공시자료 보관함 루트 */
  disclosureRoot: string;
  inbox: string;
  archive: string;
  guides: string;
}

export interface PathOverrides {
  db?: string;
  disclosureRoot?: string;
}

/**
 * OS별 기본 경로를 계산한다.
 * 환경변수 VC_FUNDS_DB / VC_FUNDS_DISCLOSURE_DIR 로 개별 override 가능.
 */
export function defaultPaths(
  overrides: PathOverrides = {},
  env: Record<string, string | undefined> = process.env,
): AppPaths {
  const home = env.VC_FUNDS_HOME ?? homedir();
  const isWindows = platform() === "win32";

  const dataDir = isWindows
    ? join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "MoonkLabs", "vc-funds")
    : join(home, ".local", "share", "moonklabs", "vc-funds");

  const db =
    overrides.db && overrides.db !== "auto"
      ? overrides.db
      : (env.VC_FUNDS_DB ?? join(dataDir, "vc-funds.sqlite"));

  const disclosureRoot =
    overrides.disclosureRoot ??
    env.VC_FUNDS_DISCLOSURE_DIR ??
    join(home, "Documents", "MoonkLabs", "VC Disclosures");

  return {
    db,
    disclosureRoot,
    inbox: join(disclosureRoot, "Inbox"),
    archive: join(disclosureRoot, "Archive"),
    guides: join(disclosureRoot, "Guides"),
  };
}
