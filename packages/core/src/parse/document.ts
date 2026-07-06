import { extname } from "node:path";
import { NotImplementedError } from "../errors.ts";
import { extractHwpxText } from "./hwpx.ts";
import { extractPdfText } from "./pdf.ts";
import { parseHtmlSnapshot } from "./html.ts";

export type DocumentKind = "html_snapshot" | "csv" | "xls" | "pdf" | "hwpx" | "text";

export function detectKind(filePath: string): DocumentKind {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return "html_snapshot";
    case ".csv":
      return "csv";
    case ".xls":
    case ".xlsx":
      return "xls";
    case ".pdf":
      return "pdf";
    case ".hwpx":
      return "hwpx";
    case ".txt":
    case ".md":
      return "text";
    default:
      throw new Error(`지원하지 않는 파일 형식입니다: ${ext || "(확장자 없음)"}`);
  }
}

/** 파일 종류에 따라 본문 텍스트를 추출한다. */
export async function extractDocumentText(kind: DocumentKind, buffer: Uint8Array): Promise<string> {
  const decoder = new TextDecoder("utf-8");
  switch (kind) {
    case "hwpx":
      return extractHwpxText(buffer);
    case "pdf":
      return extractPdfText(buffer);
    case "html_snapshot":
      return parseHtmlSnapshot(decoder.decode(buffer)).text;
    case "text":
    case "csv":
      return decoder.decode(buffer);
    case "xls":
      throw new NotImplementedError("XLS/XLSX 파싱", "SheetJS 계열 파서 통합 예정");
  }
}
