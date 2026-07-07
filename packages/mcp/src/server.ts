import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  VERSION,
  openDatabase,
  defaultPaths,
  searchGuides,
  searchInvestors,
  searchFunds,
  listEvents,
  listGuideSources,
  getDbStatus,
  getPolicy,
  KVIC_FUND_GROUPS,
  fetchAndImportKvic,
  fetchAndImportDiva,
} from "@moonklabs/vc-fund-disclosure-core";

interface TextResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

function jsonResult(payload: unknown): TextResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/**
 * vc-fund-disclosure stdio MCP server.
 * 모든 응답은 evidence_type 필드로 공시 근거 / 공식 가이드 / 사용자 노트를 구분한다.
 */
export function buildServer(dbPath: string): McpServer {
  const db = openDatabase(dbPath);
  const server = new McpServer({ name: "vc-fund-disclosure", version: VERSION });

  server.registerTool(
    "search_investors",
    {
      title: "투자사 검색",
      description: "로컬 DB에 축적된 VC/AC 투자사를 이름으로 검색합니다 (KVIC/KVCA/TIPS 공시 근거).",
      inputSchema: {
        query: z.string().describe("투자사명 (부분 일치, 한국어 지원)"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ query, limit }) =>
      jsonResult({
        evidence_type: "disclosure",
        results: searchInvestors(db, query, limit ?? 20),
      }),
  );

  server.registerTool(
    "search_funds",
    {
      title: "펀드 검색",
      description: "공시된 펀드(조합)를 펀드명 또는 운용사명으로 검색합니다.",
      inputSchema: {
        query: z.string().describe("펀드명 또는 운용사명"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ query, limit }) =>
      jsonResult({
        evidence_type: "disclosure",
        results: searchFunds(db, query, limit ?? 20),
      }),
  );

  server.registerTool(
    "search_guides",
    {
      title: "창업자 가이드 검색",
      description:
        "투자유치/TIPS/IR/데이터룸/투자계약 공식 가이드 문서에서 관련 내용을 검색합니다. 출처(발행처, 문서명)와 함께 반환됩니다.",
      inputSchema: {
        query: z.string().describe("질문 또는 키워드 (한국어)"),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, limit }) =>
      jsonResult({
        evidence_type: "official_guide",
        results: searchGuides(db, query, limit ?? 5),
      }),
  );

  server.registerTool(
    "list_events",
    {
      title: "공시 이벤트 조회",
      description: "신규 펀드 결성, 스냅샷 import 등 축적된 공시 이벤트를 시간순으로 조회합니다.",
      inputSchema: {
        since: z.string().optional().describe("ISO 날짜 (예: 2026-01-01) — 이 시점 이후만"),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ since, limit }) =>
      jsonResult({
        evidence_type: "disclosure",
        results: listEvents(db, since, limit ?? 50),
      }),
  );

  server.registerTool(
    "list_guide_sources",
    {
      title: "가이드 URL 후보 조회",
      description: "등록된 원격 가이드 URL 후보와 접근 상태(remote_gone_410 등)를 조회합니다.",
      inputSchema: {},
    },
    async () =>
      jsonResult({
        evidence_type: "user_note",
        results: listGuideSources(db),
      }),
  );

  server.registerTool(
    "fetch_and_import",
    {
      title: "KVIC 공시 온디맨드 수집",
      description:
        "KVIC FundFinder에서 분류코드별 펀드 공시를 1회 조회해 로컬 DB에 import합니다. " +
        "사용자가 CLI에서 'vc-funds fetch kvic --consent'로 robots 고지에 동의한 뒤에만 동작합니다. " +
        `분류코드: ${Object.keys(KVIC_FUND_GROUPS).join(", ")}`,
      inputSchema: {
        codes: z
          .array(z.string())
          .optional()
          .describe('분류코드 목록 (예: ["AA","AB"]) — 생략 시 전체 수집 (약 1분 소요)'),
      },
    },
    async ({ codes }) => {
      if (!getPolicy(db).on_demand_fetch) {
        return jsonResult({
          evidence_type: "user_note",
          error: "on_demand_fetch 정책이 비활성화되어 있습니다.",
          instruction:
            "터미널에서 'vc-funds fetch kvic --all --consent'를 실행해 robots 고지에 동의하면 활성화됩니다.",
        });
      }
      const paths = defaultPaths({ db: dbPath });
      const items = await fetchAndImportKvic(db, { codes, archiveDir: paths.archive });
      return jsonResult({
        evidence_type: "disclosure",
        imported: items.map((item) => ({
          code: item.code,
          label: item.label,
          duplicated: item.result.duplicated,
          rows: item.result.rawRowCount,
          funds: item.result.imported.funds,
          new_funds: item.result.imported.newFunds,
          investors: item.result.imported.investors,
          source_url: item.sourceUrl,
          captured_at: item.capturedAt,
        })),
      });
    },
  );

  server.registerTool(
    "fetch_diva_disclosures",
    {
      title: "KVCA DIVA 공시 수집",
      description:
        "KVCA DIVA(벤처투자공시시스템)에서 최근 결성/변경 공시 목록을 수집해 로컬 DB에 적재합니다. " +
        "법정 전자공시 채널이라 '최신 결성 정보'의 핵심 소스입니다. " +
        "사용자가 CLI에서 'vc-funds fetch diva --consent'로 robots 고지에 동의한 뒤에만 동작합니다.",
      inputSchema: {
        type: z.enum(["tmly", "regul"]).optional().describe("tmly=수시(결성/변경), regul=정기 (기본 tmly)"),
        period: z.enum(["1m", "6m", "1y", "all"]).optional().describe("조회 기간 (기본 1y)"),
        pages: z.number().int().min(1).max(50).optional().describe("최대 페이지 수 (페이지당 5건, 기본 10)"),
      },
    },
    async ({ type, period, pages }) => {
      if (!getPolicy(db).on_demand_fetch) {
        return jsonResult({
          evidence_type: "user_note",
          error: "on_demand_fetch 정책이 비활성화되어 있습니다.",
          instruction: "터미널에서 'vc-funds fetch diva --consent'를 실행해 robots 고지에 동의하세요.",
        });
      }
      const result = await fetchAndImportDiva(db, {
        type: type ?? "tmly",
        period: period ?? "1y",
        maxPages: pages ?? 10,
      });
      return jsonResult({ evidence_type: "disclosure", result });
    },
  );

  server.registerTool(
    "get_status",
    {
      title: "로컬 DB 상태",
      description: "테이블별 레코드 수와 수집 경계 정책 상태를 반환합니다.",
      inputSchema: {},
    },
    async () =>
      jsonResult({
        evidence_type: "user_note",
        status: getDbStatus(db),
        policy: getPolicy(db),
      }),
  );

  return server;
}

/** stdio transport로 MCP 서버를 기동한다. */
export async function serveMcp(dbPath: string): Promise<void> {
  const server = buildServer(dbPath);
  await server.connect(new StdioServerTransport());
}
