import { unzipSync, strFromU8 } from "fflate";

/**
 * HWPX(zip + OWPML XML) 파일에서 본문 텍스트를 추출한다.
 * Contents/section*.xml 의 문단(hp:p) 경계를 줄바꿈으로 유지한다.
 */
export function extractHwpxText(buffer: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer);
  } catch (error: unknown) {
    throw new Error(`HWPX 압축 해제 실패: ${errorMessage(error)}`);
  }

  const sectionPaths = Object.keys(files)
    .filter((path) => /^Contents\/section\d+\.xml$/i.test(path))
    .sort();

  if (sectionPaths.length === 0) {
    throw new Error("HWPX 본문(Contents/section*.xml)을 찾을 수 없습니다. 올바른 HWPX 파일인지 확인하세요.");
  }

  return sectionPaths
    .map((path) => {
      const data = files[path];
      return data ? xmlToPlainText(strFromU8(data)) : "";
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function xmlToPlainText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<\/hp:p>/g, "\n")
      .replace(/<hp:lineBreak\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
