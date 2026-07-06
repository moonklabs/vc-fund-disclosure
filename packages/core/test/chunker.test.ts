import { describe, expect, test } from "bun:test";
import { chunkText } from "../src/chunk/chunker.ts";

describe("chunkText", () => {
  test("빈 텍스트는 빈 배열", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("\n\n  \n")).toEqual([]);
  });

  test("짧은 텍스트는 청크 1개", () => {
    const chunks = chunkText("투자유치를 처음 준비할 때는 IR 자료부터 만듭니다.");
    expect(chunks).toHaveLength(1);
  });

  test("maxChars를 넘는 문단은 강제 분할된다", () => {
    const long = "가".repeat(3000);
    const chunks = chunkText(long, { maxChars: 1000 });
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
    }
  });

  test("문단 경계가 유지되고 원문이 모두 포함된다", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `문단 ${i} - ${"내용 ".repeat(50)}`.trim());
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text, { maxChars: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    const joined = chunks.join("\n\n");
    for (let i = 0; i < 10; i += 1) {
      expect(joined).toContain(`문단 ${i}`);
    }
  });
});
