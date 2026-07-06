import { parse } from "node-html-parser";

export interface HtmlSnapshot {
  title: string | null;
  /** 페이지 내 모든 <table>을 행×열 텍스트 배열로 추출 */
  tables: string[][][];
  /** 태그 제거 후 본문 텍스트 */
  text: string;
}

/** KVIC/KVCA 등에서 사용자가 저장한 HTML 스냅샷을 파싱한다. */
export function parseHtmlSnapshot(html: string): HtmlSnapshot {
  const root = parse(html);

  const tables = root.querySelectorAll("table").map((table) =>
    table.querySelectorAll("tr").map((row) =>
      row.querySelectorAll("th, td").map((cell) => cell.text.trim()),
    ),
  );

  return {
    title: root.querySelector("title")?.text.trim() ?? null,
    tables,
    text: root.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
  };
}
