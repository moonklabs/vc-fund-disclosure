import { extractText, getDocumentProxy } from "unpdf";

/**
 * PDF에서 텍스트를 추출한다 (unpdf/pdf.js 기반).
 * 스캔본(이미지 PDF)은 텍스트가 비어 있을 수 있다 — OCR은 로드맵 항목.
 */
export async function extractPdfText(buffer: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (merged.length === 0) {
    throw new Error(
      "PDF에서 텍스트를 추출하지 못했습니다. 스캔본(이미지 PDF)일 수 있습니다. (로드맵: OCR 지원)",
    );
  }
  return merged;
}
