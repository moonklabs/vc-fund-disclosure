#!/usr/bin/env bun
import { Command } from "commander";
import {
  VERSION,
  NotImplementedError,
  openDatabase,
  importHtmlSnapshot,
  importDisclosureDocument,
  importSeedData,
  SEED_DATASET,
  importGuide,
  addGuideSource,
  listGuideSources,
  searchInvestors,
  searchFunds,
  searchGuides,
  listEvents,
  getPolicy,
  setPolicyFlag,
  KVIC_FUND_GROUPS,
  ON_DEMAND_FETCH_NOTICE,
  DIVA_FETCH_NOTICE,
  DATAGO_KVIC_PRESETS,
  fetchAndImportKvic,
  fetchAndImportDatago,
  fetchAndImportDiva,
  type DatagoPresetKey,
  type DivaDisclosureType,
  type DivaPeriod,
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
  .option("--with-data", "설치 직후 KVIC 공시 부트스트랩 수집 (--consent 필요)")
  .option("--consent", "robots 고지에 동의하고 on_demand_fetch 정책을 활성화")
  .action(async (options: { client: string; command?: string; withData?: boolean; consent?: boolean }) => {
    const clients: SetupClient[] = ["claude", "codex", "both", "none"];
    if (!clients.includes(options.client as SetupClient)) {
      fail(new Error(`--client 값이 잘못되었습니다: ${options.client} (claude|codex|both|none)`));
    }
    const paths = resolveAppPaths(globalOptions());
    process.exitCode = runSetup(paths, {
      client: options.client as SetupClient,
      command: options.command,
    });
    if (!options.withData) return;

    const db = openDatabase(paths.db);
    if (!getPolicy(db).on_demand_fetch && !options.consent) {
      console.error("");
      console.error("--with-data는 동의가 필요해 건너뜁니다.");
      console.error(ON_DEMAND_FETCH_NOTICE);
      return;
    }
    if (!getPolicy(db).on_demand_fetch) {
      setPolicyFlag(db, "on_demand_fetch", true);
      console.error("on_demand_fetch 정책을 활성화했습니다 (동의 저장됨).");
    }
    console.error("[bootstrap] KVIC FundFinder 전체 분류코드 수집 시작 (요청 간 지연 적용)...");
    try {
      const items = await fetchAndImportKvic(db, { archiveDir: paths.archive });
      const totals = items.reduce(
        (acc, item) => ({
          funds: acc.funds + item.result.imported.funds,
          newFunds: acc.newFunds + item.result.imported.newFunds,
          investors: acc.investors + item.result.imported.investors,
        }),
        { funds: 0, newFunds: 0, investors: 0 },
      );
      console.error(
        `[bootstrap] 완료: 분류 ${items.length}개 — 펀드 ${totals.funds} (신규 ${totals.newFunds}), 운용사 ${totals.investors}`,
      );
    } catch (error: unknown) {
      console.error(
        `[bootstrap] 수집 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
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
          : `KVIC 스냅샷 import 완료: disclosure #${result.disclosureId} — 행 ${result.rawRowCount}개 중 ${result.normalizedRowCount}개 정규화 (펀드 ${result.imported.funds}, 신규 ${result.imported.newFunds}, 운용사 ${result.imported.investors}, 경고 ${result.warnings.length})`,
      );
    } catch (error: unknown) {
      fail(error);
    }
  });

importCommand
  .command("kvca")
  .description("KVCA DIVA HTML/CSV 스냅샷 import")
  .requiredOption("--file <path>", "저장된 HTML 또는 CSV 파일")
  .action((options: { file: string }) => {
    try {
      const db = openDatabase(resolveAppPaths(globalOptions()).db);
      const result = importHtmlSnapshot(db, { filePath: options.file, source: "kvca" });
      console.log(
        result.duplicated
          ? `이미 import된 스냅샷입니다 (disclosure #${result.disclosureId})`
          : `KVCA 스냅샷 import 완료: disclosure #${result.disclosureId} — 행 ${result.rawRowCount}개 중 ${result.normalizedRowCount}개 정규화 (펀드 ${result.imported.funds}, 신규 ${result.imported.newFunds}, 운용사 ${result.imported.investors}, 경고 ${result.warnings.length})`,
      );
    } catch (error: unknown) {
      fail(error);
    }
  });

importCommand
  .command("seed")
  .description("번들 시드 데이터 import — 모태펀드 자조합 운용사 327개 (data.go.kr 공공 개방, 오프라인)")
  .action(() => {
    try {
      const paths = resolveAppPaths(globalOptions());
      const db = openDatabase(paths.db);
      const { filePath, result } = importSeedData(db, { archiveDir: paths.archive });
      console.log(
        result.duplicated
          ? `시드 데이터는 이미 import되어 있습니다 (disclosure #${result.disclosureId})`
          : `시드 import 완료: ${SEED_DATASET.title} — 행 ${result.rawRowCount}, 운용사 ${result.imported.investors} (${filePath})`,
      );
      console.log(`출처: ${SEED_DATASET.sourceUrl} (${SEED_DATASET.license})`);
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

const fetchCommand = program
  .command("fetch")
  .description("공식 공시 데이터 온디맨드 수집 (사용자 명령 실행 시에만 네트워크 접근)");

fetchCommand
  .command("kvic")
  .description("KVIC FundFinder 분류코드별 펀드 목록 조회 + import (robots 고지 동의 필요)")
  .option("--code <codes>", "분류코드 쉼표 구분 (예: AA,AB)")
  .option("--all", "전체 분류코드 수집")
  .option("--consent", "robots 고지에 동의하고 on_demand_fetch 정책을 1회 활성화")
  .option("--list", "분류코드 목록 출력")
  .action(async (options: { code?: string; all?: boolean; consent?: boolean; list?: boolean }) => {
    try {
      if (options.list) {
        for (const [code, label] of Object.entries(KVIC_FUND_GROUPS)) {
          console.log(`${code}  ${label}`);
        }
        return;
      }
      const codes = options.all
        ? undefined
        : options.code?.split(",").map((code) => code.trim()).filter(Boolean);
      if (!options.all && (!codes || codes.length === 0)) {
        fail(new Error("--code AA,AB 또는 --all 을 지정하세요. 분류코드 목록: vc-funds fetch kvic --list"));
      }
      const paths = resolveAppPaths(globalOptions());
      const db = openDatabase(paths.db);
      if (!getPolicy(db).on_demand_fetch) {
        if (!options.consent) {
          console.error(ON_DEMAND_FETCH_NOTICE);
          process.exit(1);
        }
        setPolicyFlag(db, "on_demand_fetch", true);
        console.error("on_demand_fetch 정책을 활성화했습니다 (동의 저장됨).");
      }
      const items = await fetchAndImportKvic(db, { codes, archiveDir: paths.archive });
      for (const item of items) {
        const r = item.result;
        console.log(
          r.duplicated
            ? `[${item.code}] ${item.label}: 변경 없음 (동일 스냅샷)`
            : `[${item.code}] ${item.label}: 행 ${r.rawRowCount} → 정규화 ${r.normalizedRowCount} (펀드 ${r.imported.funds}, 신규 ${r.imported.newFunds}, 운용사 ${r.imported.investors}) — ${item.filePath}`,
        );
      }
    } catch (error: unknown) {
      fail(error);
    }
  });

fetchCommand
  .command("datago")
  .description("공공데이터포털(data.go.kr) 오픈API 수집 + import (공식 개방 데이터, serviceKey 필요)")
  .option("--preset <key>", `KVIC preset (${Object.keys(DATAGO_KVIC_PRESETS).join(", ")})`)
  .option("--endpoint <url>", "odcloud API endpoint (preset 미사용 시)")
  .option("--key <serviceKey>", "인증키 (미지정 시 env DATA_GO_KR_SERVICE_KEY)")
  .option("--source <source>", "kvic | kvca | tips | manual", "kvic")
  .option("--label <label>", "보관 파일명 라벨", "datago")
  .option("--list", "preset 목록 출력")
  .action(async (options: { preset?: string; endpoint?: string; key?: string; source: string; label: string; list?: boolean }) => {
    try {
      if (options.list) {
        for (const [key, p] of Object.entries(DATAGO_KVIC_PRESETS)) {
          console.log(`${key}  —  ${p.title}`);
        }
        return;
      }
      const preset = options.preset
        ? DATAGO_KVIC_PRESETS[options.preset as DatagoPresetKey]
        : undefined;
      if (options.preset && !preset) {
        fail(new Error(`알 수 없는 preset: ${options.preset} (${Object.keys(DATAGO_KVIC_PRESETS).join(", ")})`));
      }
      const endpoint = preset?.endpoint ?? options.endpoint;
      if (!endpoint) {
        fail(new Error("--preset 또는 --endpoint 를 지정하세요. 목록: vc-funds fetch datago --list"));
      }
      const serviceKey = options.key ?? process.env.DATA_GO_KR_SERVICE_KEY;
      if (!serviceKey) {
        fail(
          new Error(
            "data.go.kr 인증키가 필요합니다. https://www.data.go.kr 활용신청 후 발급받아\n" +
              "  export DATA_GO_KR_SERVICE_KEY='발급키'  또는  --key '발급키' 로 지정하세요.",
          ),
        );
      }
      const paths = resolveAppPaths(globalOptions());
      const db = openDatabase(paths.db);
      const outcome = await fetchAndImportDatago(db, {
        endpoint,
        serviceKey,
        archiveDir: paths.archive,
        source: (preset?.source ?? options.source) as "kvic" | "kvca" | "tips" | "manual",
        label: options.preset ?? options.label,
      });
      const r = outcome.result;
      console.log(
        r.duplicated
          ? `변경 없음 (동일 데이터, disclosure #${r.disclosureId})`
          : `data.go.kr import 완료 [${preset?.title ?? "custom"}]: 행 ${outcome.rowCount}/${outcome.totalCount} — 정규화 ${r.normalizedRowCount} (펀드 ${r.imported.funds}, 운용사 ${r.imported.investors}) — ${outcome.filePath}`,
      );
    } catch (error: unknown) {
      fail(error);
    }
  });

fetchCommand
  .command("diva")
  .description("KVCA DIVA 공시 목록 수집 + import (robots 고지 동의 필요, 법정 결성/변경 공시)")
  .option("--type <type>", "tmly(수시) | regul(정기)", "tmly")
  .option("--period <period>", "1m | 6m | 1y | all", "1y")
  .option("--pages <n>", "최대 페이지 수 (페이지당 5건)", "20")
  .option("--consent", "robots 고지에 동의하고 on_demand_fetch 정책을 활성화")
  .action(async (options: { type: string; period: string; pages: string; consent?: boolean }) => {
    try {
      const paths = resolveAppPaths(globalOptions());
      const db = openDatabase(paths.db);
      if (!getPolicy(db).on_demand_fetch) {
        if (!options.consent) {
          console.error(DIVA_FETCH_NOTICE);
          process.exit(1);
        }
        setPolicyFlag(db, "on_demand_fetch", true);
        console.error("on_demand_fetch 정책을 활성화했습니다 (동의 저장됨).");
      }
      const result = await fetchAndImportDiva(db, {
        type: options.type as DivaDisclosureType,
        period: options.period as DivaPeriod,
        maxPages: Number(options.pages),
      });
      console.log(
        `DIVA ${result.type === "tmly" ? "수시" : "정기"}공시 수집 완료: ` +
          `${result.pagesFetched}페이지, 공시 ${result.rows}건 — 신규 운용사 ${result.newInvestors}, 신규 공시이벤트 ${result.disclosureEvents}`,
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
