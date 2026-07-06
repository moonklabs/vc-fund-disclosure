import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppPaths } from "@moonklabs/vc-fund-disclosure-core";
import { runDoctorChecks, formatDoctorReport, worstStatus } from "../src/doctor-checks.ts";

function tempPaths(): AppPaths {
  const root = mkdtempSync(join(tmpdir(), "vc-funds-doctor-"));
  return {
    db: join(root, "db", "vc-funds.sqlite"),
    disclosureRoot: root,
    inbox: join(root, "Inbox"),
    archive: join(root, "Archive"),
    guides: join(root, "Guides"),
  };
}

describe("runDoctorChecks", () => {
  test("폴더가 없으면 WARN, DB는 자동 생성되어 OK", () => {
    const paths = tempPaths();
    const checks = runDoctorChecks(paths, { skipClientConfig: true });

    const byItem = new Map(checks.map((c) => [c.item, c]));
    expect(byItem.get("DB 접근")?.status).toBe("OK");
    expect(byItem.get("Inbox")?.status).toBe("WARN");
    expect(byItem.get("Guide Library")?.status).toBe("WARN");
    expect(byItem.get("정책")?.status).toBe("OK");
    expect(worstStatus(checks)).toBe("WARN");
  });

  test("폴더가 있으면 Inbox/Guides OK", () => {
    const paths = tempPaths();
    mkdirSync(paths.inbox, { recursive: true });
    mkdirSync(paths.guides, { recursive: true });
    const checks = runDoctorChecks(paths, { skipClientConfig: true });

    const byItem = new Map(checks.map((c) => [c.item, c]));
    expect(byItem.get("Inbox")?.status).toBe("OK");
    expect(byItem.get("Guide Library")?.status).toBe("OK");
  });

  test("리포트는 스펙의 마크다운 테이블 형식", () => {
    const paths = tempPaths();
    const report = formatDoctorReport(runDoctorChecks(paths, { skipClientConfig: true }));
    expect(report).toContain("# VC Funds Local MCP Doctor");
    expect(report).toContain("| 항목 | 상태 | 설명 |");
  });
});
