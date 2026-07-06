/**
 * 한국어/영문 혼용 텍스트 정규화 유틸.
 * k-startup-plugins 스펙 팩 runtime/src/normalize.mjs에서 이식.
 */

/** NFKC 정규화 + 소문자 + 구두점을 공백으로 치환. */
export function normalizeText(value: string | null | undefined = ""): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._,;:!?()[\]{}"'`~|/\\<>+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 공백/구두점/기호를 모두 제거한 비교용 키. 엔티티 dedupe에 사용. */
export function normalizeKey(value: string | null | undefined = ""): string {
  return normalizeText(value).replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 공백 정리 후 빈 문자열이면 null. */
export function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}
