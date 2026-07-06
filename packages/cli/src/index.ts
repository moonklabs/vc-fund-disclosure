#!/usr/bin/env bun
import { Command } from "commander";
import {
  VERSION,
  NotImplementedError,
  openDatabase,
  importHtmlSnapshot,
  importDisclosureDocument,
  importGuide,
  addGuideSource,
  listGuideSources,
  searchInvestors,
  searchFunds,
  searchGuides,
  listEvents,
  type GuideRole,
} from "@moonklabs/vc-fund-disclosure-core";
import { serveMcp } from "@moonklabs/vc-fund-disclosure-mcp";
import { resolveAppPaths, type GlobalCliOptions } from "./resolve.ts";
import { runSetup, type SetupClient } from "./commands/setup.ts";
import { runDoctorChecks, formatDoctorReport, worstStatus } from "./doctor-checks.ts";
import { startWatch } from "./commands/watch.ts";

const program = new Command();

program
  .name("vc-funds")
  .description("VC/AC 공시정보와 창업자 가이드를 개인 로컬 DB에 축적하고 MCP로 조회하는 CLI")
  .version(VERSION)
  .option("--db <path>", "SQLite DB 경로 (기본: auto)", "auto")
  .option("--disclosure-dir <path>", "보관함 루트 경로 override");

function globalOptions(): GlobalCliOptions {
  const opts = program.opts<{ db: string; disclosureDir?: string }>();
  return { db: opts.db, disclosureDir: opts.disclosureDir };
}

function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error instanceof NotImplementedError ? 2 : 1);
}

program
  .command("setup")
  .description("DB/보관함/guide library/watch folder 생성 및 MCP 클라이언트 등록")
  .option("--client <client>", "claude | codex | both | none", "claude")
  .option("--command <path>", "MCP 설정에 기록할 실행 파일 경로 override")
  .action((options: { client: string; command?: string }) => {
    const clients: SetupClient[] = ["claude", "codex", "both", "none"];
    if (!clients.includes(options.client as SetupClient)) {
      fail(new Error(`--client 값이 잘못되었습니다: ${options.client} (claude|codex|both|none)`));
    }
    const paths = resolveAppPaths(globalOptions());
    process.exitCode = runSetup(paths, {
      client: options.client as SetupClient,
      command: options.command,
    });
  });

program
  .command("doctor")
  .description("설치 상태 점검 리포트 출력")
  .action(() => {
    const paths = resolveAppPaths(globalOptions());
    const checks = runDoctorChecks(paths);
    console.log(formatDoctorReport(checks));
    process.exitCode = worstStatus(checks) === "BLOCKED" ? 1 : 0;
  });

const importCommand = program.command("import").description("공시 스냅샷/문서/가이드 import");

importCommand
  .command("kvic")
  .description("KVIC FundFinder HTML 스냅샷 import")
  .requiredOption("--file <path>", "저장된 HTML 파일")
  .option("--group <group>", "FundFinder 그룹 코드 (예: AA)")
  .option("--code <code>", "FundFinder 상세 코드 (예: AA02)")
  .action((options: { file: string; group?: string; code?: string }) => {
    try {
      const db = openDatabase(resolveAppPaths(globalOptions()).db);
      const result = importHtmlSnapshot(db, {
        filePath: options.file,
        source: "kvic",
        group: options.group,
        code: options.code,
      });
      console.log(
        result.duplicated
          ? `이미 import된 스냅샷입니다 (disclosure #${result.disclosureId})`
          : `KVIC 스냅샷 import 완료: disclosure #${result.disclosureId} (테이블 ${result.tableCount}개)`,
      );
    } catch (error: unknown) {
      fail(error);
    }
  });

importCommand
  .command("kvca")
  .description("KVCA DIVA HTML 스냅샷 import")
  .requiredOption("--file <path>", "저장된 HTML 파일")
  .action((options: { file: string }) => {
    try {
      const db = openDatabase(resolveAppPaths(globalOptions()).db);
      const result = importHtmlSnapshot(db, { filePath: options.file, source: "kvca" });
      console.log(
        result.duplicated
          ? `이미 import된 스냅샷입니다 (disclosure #${result.disclosureId})`
          : `KVCA 스냅샷 import 완료: disclosure #${result.disclosureId} (테이블 ${result.tableCount}개)`,
      );
    } catch (error: unknown) {
      fail(error);
    }
  });

importCommand
  .command("document")
  .description("공시 문서(PDF/HWPX/HTML/CSV) import")
  .requiredOption("--file <path>", "문서 파일")
  .option("--source <source>", "kvic | kvca | tips | manual", "manual")
  .action(async (options: { file: string; source: string }) => {
    try {
      const db = openDatabase(resolveAppPaths(globalOptions()).db);
      const result = await importDisclosureDocument(db, {
        filePath: options.file,
        source: options.source as "kvic" | "kvca" | "tips" | "manual",
      });
      console.log(
        result.duplicated
          ? `이미 import된 문서입니다 (disclosure #${result.disclosureId})`
          : `문서 import 완료: disclosure #${result.disclosureId} (${result.kind}, ${result.parseStatus})`,
      );
    } catch (error: unknown) {
      fail(error);
    }
  });

importCommand
  .command("guide")
  .description("창업자 가이드(PDF/HWPX/텍스트) import 및 FTS 색인")
  .requiredOption("--file <path>", "가이드 파일")
  .option("--role <role>", "founder_education | tips | ir | dataroom | term_sheet", "founder_education")
  .option("--publisher <name>", "발행처 (예: KVIC)")
  .option("--source-url <url>", "원본 URL")
  .action(async (options: { file: string; role: string; publisher?: string; sourceUrl?: string }) => {
    try {
      const db = openDatabase(resolveAppPaths(globalOptions()).db);
      const result = await importGuide(db, {
        filePath: options.file,
        role: options.role as GuideRole,
        publisher: options.publisher,
        sourceUrl: options.sourceUrl,
      });
      console.log(
        result.duplicated
          ? `이미 색인된 가이드입니다 (guide #${result.guideId}, 청크 ${result.chunkCount}개)`
          : `가이드 import 완료: guide #${result.guideId} (청크 ${result.chunkCount}개)`,
      );
    } catch (error: unknown) {
      fail(error);
    }
  });

program
  .command("query")
  .description("로컬 DB 조회 (예: vc-funds query investor 프라이머)")
  .argument("<type>", "investor | fund")
  .argument("<term>", "검색어")
  .action((type: string, term: string) => {
    const db = openDatabase(resolveAppPaths(globalOptions()).db);
    if (type === "investor") {
      const rows = searchInvestors(db, term);
      console.log(rows.length === 0 ? "결과 없음" : JSON.stringify(rows, null, 2));
      return;
    }
    if (type === "fund") {
      const rows = searchFunds(db, term);
      console.log(rows.length === 0 ? "결과 없음" : JSON.stringify(rows, null, 2));
      return;
    }
    fail(new Error(`알 수 없는 query 타입: ${type} (investor|fund)`));
  });

program
  .command("ask")
  .description("창업자 가이드 코퍼스에서 관련 근거 검색 (답변 합성은 MCP 클라이언트가 수행)")
  .argument("<question...>", "질문")
  .action((questionWords: string[]) => {
    const db = openDatabase(resolveAppPaths(globalOptions()).db);
    const question = questionWords.join(" ");
    const hits = searchGuides(db, question, 5);
    if (hits.length === 0) {
      console.log("관련 가이드 근거를 찾지 못했습니다. 'vc-funds import guide'로 가이드를 먼저 색인하세요.");
      return;
    }
    for (const hit of hits) {
      console.log(`--- [${hit.publisher ?? "출처미상"}] ${hit.title} (청크 #${hit.seq}) ---`);
      console.log(hit.content);
      console.log("");
    }
    console.error("(참고: 위 결과는 검색된 원문 근거입니다. 요약/답변 합성은 Claude/Codex에서 수행됩니다.)");
  });

program
  .command("events")
  .description("공시 이벤트 조회")
  .option("--since <date>", "ISO 날짜 (예: 2026-01-01)")
  .action((options: { since?: string }) => {
    const db = openDatabase(resolveAppPaths(globalOptions()).db);
    const rows = listEvents(db, options.since);
    console.log(rows.length === 0 ? "이벤트 없음" : JSON.stringify(rows, null, 2));
  });

const guideSource = program.command("guide-source").description("가이드 원격 URL 후보 관리");

guideSource
  .command("add")
  .description("URL 후보 등록 (실제 파일 import와 분리)")
  .requiredOption("--url <url>", "원본 URL")
  .option("--publisher <name>", "발행처")
  .option("--role <role>", "founder_education 등", "founder_education")
  .option("--access-status <status>", "ok | remote_gone_410 | forbidden | unknown", "unknown")
  .action((options: { url: string; publisher?: string; role: string; accessStatus: string }) => {
    try {
      const db = openDatabase(resolveAppPaths(globalOptions()).db);
      const row = addGuideSource(db, {
        url: options.url,
        publisher: options.publisher,
        role: options.role,
        accessStatus: options.accessStatus as "ok" | "remote_gone_410" | "forbidden" | "unknown",
      });
      console.log(`guide source #${row.id} 등록 완료 (${row.access_status})`);
    } catch (error: unknown) {
      fail(error);
    }
  });

guideSource
  .command("list")
  .description("등록된 URL 후보 목록")
  .action(() => {
    const db = openDatabase(resolveAppPaths(globalOptions()).db);
    const rows = listGuideSources(db);
    console.log(rows.length === 0 ? "등록된 URL 후보 없음" : JSON.stringify(rows, null, 2));
  });

program
  .command("watch")
  .description("Inbox/Guides watch folder 감시 시작 (자동 import)")
  .action(() => {
    const paths = resolveAppPaths(globalOptions());
    const db = openDatabase(paths.db);
    startWatch(db, paths);
  });

program
  .command("diff")
  .description("두 스냅샷 간 신규/변경 펀드 비교 (미구현)")
  .action(() => {
    fail(new NotImplementedError("스냅샷 diff", "KVIC/KVCA 컬럼 정규화 매핑 완료 후 지원"));
  });

const mcp = program.command("mcp").description("MCP server 관련 명령");

mcp
  .command("serve")
  .description("stdio MCP server 기동")
  .action(async () => {
    try {
      await serveMcp(resolveAppPaths(globalOptions()).db);
    } catch (error: unknown) {
      fail(error);
    }
  });

program.parseAsync(process.argv).catch(fail);
