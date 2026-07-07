import { describe, expect, test } from "bun:test";
import { amountScaleFromHeader } from "../src/normalize/fields.ts";
import {
  canonicalFieldForHeader,
  normalizeDate,
  normalizeSnapshotRow,
  normalizeStage,
  parseKrwAmount,
  splitNames,
} from "../src/normalize/fields.ts";

describe("parseKrwAmount", () => {
  test("한국어 단위(조/억/만)를 원 단위로 변환한다", () => {
    expect(parseKrwAmount("300억")).toBe(30_000_000_000);
    expect(parseKrwAmount("1.5조")).toBe(1_500_000_000_000);
    expect(parseKrwAmount("1조 2000억")).toBe(1_200_000_000_000);
    expect(parseKrwAmount("2,500만")).toBe(25_000_000);
  });

  test("순수 숫자와 콤마 표기를 처리한다", () => {
    expect(parseKrwAmount("30000000000")).toBe(30_000_000_000);
    expect(parseKrwAmount("1,234")).toBe(1234);
  });

  test("파싱 불가 값은 null", () => {
    expect(parseKrwAmount("미공개")).toBeNull();
    expect(parseKrwAmount("")).toBeNull();
    expect(parseKrwAmount(null)).toBeNull();
  });
});

describe("normalizeDate", () => {
  test("다양한 한국어/구분자 표기를 ISO로 변환한다", () => {
    expect(normalizeDate("2024년 3월 5일")).toBe("2024-03-05");
    expect(normalizeDate("2024.03.05")).toBe("2024-03-05");
    expect(normalizeDate("2024-3-5")).toBe("2024-03-05");
    expect(normalizeDate("2024/12/31")).toBe("2024-12-31");
  });

  test("파싱 불가 값은 null", () => {
    expect(normalizeDate("만기 없음")).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });
});

describe("splitNames", () => {
  test("구분자와 접속사로 복수 운용사를 분리한다", () => {
    expect(splitNames("프라이머, 블루포인트")).toEqual(["프라이머", "블루포인트"]);
    expect(splitNames("프라이머 및 블루포인트")).toEqual(["프라이머", "블루포인트"]);
    expect(splitNames("A·B/C")).toEqual(["A", "B", "C"]);
  });

  test("'외 N개사' 꼬리와 괄호 주석을 제거한다", () => {
    expect(splitNames("한국투자파트너스 외 2개사")).toEqual(["한국투자파트너스"]);
    expect(splitNames("프라이머(유한회사)")).toEqual(["프라이머"]);
  });
});

describe("normalizeStage", () => {
  test("한글/영문 단계 표기를 canonical 코드로 변환한다", () => {
    expect(normalizeStage("시드")).toBe("seed");
    expect(normalizeStage("프리시드")).toBe("pre_seed");
    expect(normalizeStage("프리A")).toBe("pre_a");
    expect(normalizeStage("Series A")).toBe("series_a");
  });

  test("매칭 실패 시 원문을 유지한다", () => {
    expect(normalizeStage("그로스")).toBe("그로스");
  });
});

describe("canonicalFieldForHeader", () => {
  test("괄호 주석이 붙은 한국어 헤더를 매핑한다", () => {
    expect(canonicalFieldForHeader("결성총액(억원)")).toBe("committedAmountKrw");
    expect(canonicalFieldForHeader("펀드명")).toBe("fundName");
    expect(canonicalFieldForHeader("업무집행조합원")).toBe("investorNames");
    expect(canonicalFieldForHeader("알 수 없는 컬럼")).toBeNull();
  });
});

describe("normalizeSnapshotRow", () => {
  test("KVIC 행을 canonical 필드로 정규화한다", () => {
    const row = normalizeSnapshotRow(
      {
        펀드명: "청년창업펀드1호",
        운용사: "프라이머 및 블루포인트",
        결성일: "2024.01.15",
        "결성총액(억원)": "300억",
        투자단계: "시드",
      },
      { source: "kvic", rowIndex: 1 },
    );
    expect(row.fundName).toBe("청년창업펀드1호");
    expect(row.investorNames).toEqual(["프라이머", "블루포인트"]);
    expect(row.formedDate).toBe("2024-01-15");
    expect(row.committedAmountKrw).toBe(30_000_000_000);
    expect(row.startupStage).toBe("seed");
    expect(row.warnings).toEqual([]);
  });

  test("KVCA 행은 조합명을 펀드명으로 보완한다", () => {
    const row = normalizeSnapshotRow(
      { 조합명: "예시벤처조합", 업무집행조합원: "예시파트너스" },
      { source: "kvca", rowIndex: 1 },
    );
    expect(row.fundName).toBe("예시벤처조합");
    expect(row.associationName).toBe("예시벤처조합");
  });

  test("펀드명 누락과 금액 파싱 실패는 warning으로 기록한다", () => {
    const row = normalizeSnapshotRow(
      { 운용사: "프라이머", 결성총액: "비공개" },
      { source: "kvic", rowIndex: 3 },
    );
    expect(row.fundName).toBeNull();
    expect(row.warnings.some((w) => w.includes("펀드/조합명"))).toBe(true);
    expect(row.warnings.some((w) => w.includes("금액 파싱 실패"))).toBe(true);
  });

  test("헤더 단위 스케일: 결성총액(백만원) 숫자값에 백만원 스케일 적용", () => {
    // data.go.kr 자조합 현황: 값은 순수 숫자, 단위는 헤더에
    const row = normalizeSnapshotRow(
      {
        조합명: "스틱일자리창출펀드",
        대표GP: "스틱벤처스",
        조합결성일: "2004-06-30",
        "결성총액(백만원)": "33400",
      },
      { source: "kvic", rowIndex: 1 },
    );
    expect(row.fundName).toBe("스틱일자리창출펀드");
    expect(row.investorNames).toEqual(["스틱벤처스"]);
    expect(row.formedDate).toBe("2004-06-30");
    // 33,400 백만원 = 334억 원
    expect(row.committedAmountKrw).toBe(33_400_000_000);
  });

  test("값에 억 단위가 있으면 헤더 스케일을 이중 적용하지 않는다", () => {
    // FundFinder: 값에 "억"이 붙어있고 헤더에 (억원) 단위
    const row = normalizeSnapshotRow(
      { 펀드명: "예시펀드", "결성총액(억원)": "300억" },
      { source: "kvic", rowIndex: 1 },
    );
    expect(row.committedAmountKrw).toBe(30_000_000_000); // 300억, 이중적용 아님
  });

  test("amountScaleFromHeader 단위 매핑", () => {
    expect(amountScaleFromHeader("결성총액(백만원)")).toBe(1_000_000);
    expect(amountScaleFromHeader("결성총액(억원)")).toBe(100_000_000);
    expect(amountScaleFromHeader("결성총액")).toBe(1);
  });
});
