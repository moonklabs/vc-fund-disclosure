import { describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { extractHwpxText } from "../src/parse/hwpx.ts";

function makeHwpxFixture(sections: string[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "mimetype": strToU8("application/hwp+zip"),
  };
  sections.forEach((body, index) => {
    files[`Contents/section${index}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="x" xmlns:hp="y">${body}</hs:sec>`,
    );
  });
  return zipSync(files);
}

describe("extractHwpxText", () => {
  test("hp:t 텍스트를 문단 단위로 추출한다", () => {
    const fixture = makeHwpxFixture([
      "<hp:p><hp:run><hp:t>투자유치 첫 단계는 IR 자료 준비입니다.</hp:t></hp:run></hp:p>" +
        "<hp:p><hp:run><hp:t>두 번째는 투자자 리스트업입니다.</hp:t></hp:run></hp:p>",
    ]);
    const text = extractHwpxText(fixture);
    expect(text).toContain("투자유치 첫 단계는 IR 자료 준비입니다.");
    expect(text).toContain("두 번째는 투자자 리스트업입니다.");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  test("여러 섹션을 순서대로 합친다", () => {
    const fixture = makeHwpxFixture([
      "<hp:p><hp:t>섹션0</hp:t></hp:p>",
      "<hp:p><hp:t>섹션1</hp:t></hp:p>",
    ]);
    const text = extractHwpxText(fixture);
    expect(text.indexOf("섹션0")).toBeLessThan(text.indexOf("섹션1"));
  });

  test("본문 섹션이 없으면 명확한 에러", () => {
    const noSection = zipSync({ "mimetype": strToU8("application/hwp+zip") });
    expect(() => extractHwpxText(noSection)).toThrow("section*.xml");
  });

  test("zip이 아니면 압축 해제 에러", () => {
    expect(() => extractHwpxText(strToU8("not a zip"))).toThrow("압축 해제 실패");
  });
});
