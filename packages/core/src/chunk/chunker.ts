export interface ChunkOptions {
  /** 청크 최대 길이(문자 수) */
  maxChars?: number;
  /** 이 길이보다 짧은 청크는 다음 청크와 병합 */
  minChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_MIN_CHARS = 200;

/**
 * 가이드 본문을 문단 경계 기준으로 청크로 나눈다.
 * - 문단(빈 줄) 단위로 누적하다가 maxChars를 넘으면 청크를 확정한다.
 * - 한 문단이 maxChars보다 길면 문자 단위로 강제 분할한다.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) {
      flush();
    }
    current = current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return mergeShortChunks(chunks, minChars, maxChars);
}

function mergeShortChunks(chunks: string[], minChars: number, maxChars: number): string[] {
  const merged: string[] = [];
  for (const chunk of chunks) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.length < minChars && last.length + chunk.length + 2 <= maxChars) {
      merged[merged.length - 1] = `${last}\n\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}
