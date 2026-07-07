import { normalizeKey, normalizeOptionalText, normalizeText } from "./text.ts";

/**
 * KVIC FundFinder / KVCA DIVA 스냅샷 컬럼 정규화.
 * k-startup-plugins 스펙 팩 runtime/src/import-normalizers.mjs에서 이식.
 */

/** canonical 필드 → 한국어/영문 헤더 별칭 사전. */
export const FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  fundName: ["펀드명", "조합명", "투자조합명", "펀드", "fund name", "association name"],
  associationName: ["조합명", "투자조합명", "association name", "asct name"],
  investorNames: ["운용사", "운용사명", "업무집행조합원", "업무집행조합원명", "vc명", "vc", "회사명", "대표운영사", "대표운용사", "운영사", "대표gp", "gp", "operator", "operators"],
  investorType: ["운영사구분", "운용사구분", "회사구분", "operator type", "investor type"],
  asctId: ["조합id", "조합 id", "asct id", "asct_id", "association id"],
  formedDate: ["결성일", "결성일자", "설립일", "조합결성일", "formed date"],
  registeredDate: ["등록일", "등록일자", "registered date"],
  expiryDate: ["만기일", "존속기간종료일", "존속만기", "expiry date", "청산예정일"],
  durationText: ["존속기간", "운용기간", "duration"],
  committedAmountKrw: ["결성총액", "결성금액", "약정총액", "출자약정액", "결성총액억원", "committed amount"],
  investedAmountKrw: ["투자금액", "투자집행", "투자집행액", "집행액", "invested amount"],
  mfundInvestedKrw: ["모태출자액", "모태펀드출자", "모태출자", "mfund invested"],
  investmentPurpose: ["투자목적", "운용목적", "목적", "investment purpose"],
  investmentField: ["투자분야", "주력투자분야", "분야", "investment field"],
  categoryCode: ["대분류코드", "그룹코드", "category code"],
  categoryName: ["대분류", "분야", "카테고리", "category"],
  subcategoryCode: ["세부분류코드", "상세코드", "subcategory code"],
  subcategoryName: ["세부분류", "상세분야", "소분류", "subcategory"],
  sectorKeyword: ["섹터", "산업", "키워드", "sector", "keyword"],
  startupStage: ["단계", "투자단계", "성장단계", "stage"],
  region: ["지역", "권역", "region"],
  purposeType: ["목적유형", "purpose type"],
  supportType: ["지원유형", "support type"],
  accountType: ["계정구분", "account type"],
  representativeFundManager: ["대표펀드매니저", "대표 펀드매니저", "fund manager"],
});

const ALIAS_TO_FIELD = new Map<string, string>(
  Object.entries(FIELD_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [normalizeHeaderName(alias), field] as [string, string]),
  ),
);

/** 헤더에서 괄호 주석을 제거하고 비교용 키로 변환. */
export function normalizeHeaderName(value: string): string {
  return normalizeKey(String(value ?? "").replace(/\([^)]*\)/g, ""));
}

export function canonicalFieldForHeader(header: string): string | null {
  return ALIAS_TO_FIELD.get(normalizeHeaderName(header)) ?? null;
}

/**
 * 한국어 금액 표기를 원(KRW) 단위 정수로 변환.
 * 지원: "1.5조", "300억", "2,500만", "1조 2000억", 순수 숫자.
 */
export function parseKrwAmount(value: unknown): number | null {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  const normalized = raw.normalize("NFKC").replace(/,/g, "").replace(/\s+/g, "");
  let total = 0;
  let consumedUnit = false;

  const trillion = normalized.match(/([0-9]+(?:\.[0-9]+)?)조/);
  if (trillion?.[1]) {
    total += Number(trillion[1]) * 1_000_000_000_000;
    consumedUnit = true;
  }

  const billion = normalized.match(/([0-9]+(?:\.[0-9]+)?)억/);
  if (billion?.[1]) {
    total += Number(billion[1]) * 100_000_000;
    consumedUnit = true;
  }

  const tenThousand = normalized.match(/([0-9]+(?:\.[0-9]+)?)만/);
  if (tenThousand?.[1] && !normalized.includes("억원")) {
    total += Number(tenThousand[1]) * 10_000;
    consumedUnit = true;
  }

  if (consumedUnit) return Math.round(total);

  const numeric = normalized.match(/[0-9]+(?:\.[0-9]+)?/);
  if (!numeric) return null;
  return Math.round(Number(numeric[0]));
}

/** "2024년 3월 5일" / "2024.03.05" / "2024-3-5" → "2024-03-05". */
export function normalizeDate(value: unknown): string | null {
  const raw = normalizeOptionalText(value);
  if (!raw) return null;
  const ymd = raw.normalize("NFKC").match(/(20\d{2}|19\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!ymd) return null;
  const [, year, month, day] = ymd;
  if (!year || !month || !day) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** 복수 운용사 분리: "A, B", "A 및 B", "A 외 2개사" 처리. */
export function splitNames(value: unknown): string[] {
  const raw = normalizeOptionalText(value);
  if (!raw) return [];
  return raw
    .replace(/\s+외\s+\d+.*$/u, "")
    .split(/[,;/\n·ㆍ]|(?:\s및\s)|(?:\s와\s)|(?:\s과\s)/u)
    .map((name) => name.replace(/\([^)]*\)/g, "").trim())
    .filter(Boolean);
}

/** 투자 단계 한글/영문 표기를 canonical 코드로. 매칭 실패 시 원문 유지. */
export function normalizeStage(value: unknown): string | null {
  const text = normalizeText(typeof value === "string" ? value : String(value ?? ""));
  if (!text) return null;
  if (/pre[\s-]?seed|프리시드/u.test(text)) return "pre_seed";
  if (/pre[\s-]?a|프리\s?a/u.test(text)) return "pre_a";
  if (/seed|시드|초기/u.test(text)) return "seed";
  if (/series\s?a|시리즈\s?a/u.test(text)) return "series_a";
  return normalizeOptionalText(value);
}

/** 정규화된 스냅샷 행. */
export interface NormalizedSnapshotRow {
  rowIndex: number;
  fundName: string | null;
  associationName: string | null;
  asctId: string | null;
  investorNames: string[];
  /** 운용사 유형 (예: 벤처투자회사, 신기술사, LLC) */
  investorType: string | null;
  formedDate: string | null;
  registeredDate: string | null;
  expiryDate: string | null;
  durationText: string | null;
  committedAmountKrw: number | null;
  investedAmountKrw: number | null;
  mfundInvestedKrw: number | null;
  investmentPurpose: string | null;
  investmentField: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  subcategoryCode: string | null;
  subcategoryName: string | null;
  sectorKeyword: string | null;
  startupStage: string | null;
  region: string | null;
  purposeType: string | null;
  supportType: string | null;
  accountType: string | null;
  representativeFundManager: string | null;
  warnings: string[];
}

type CanonicalRow = Map<string, string[]>;

interface CanonicalizedRow {
  canonical: CanonicalRow;
  /** 금액 필드별 헤더 단위 스케일 (예: "결성총액(백만원)" → 1_000_000) */
  amountScales: Map<string, number>;
}

const AMOUNT_FIELDS = new Set(["committedAmountKrw", "investedAmountKrw", "mfundInvestedKrw"]);

/** 헤더 괄호의 화폐 단위를 원(KRW) 스케일로. 단위 표기가 없으면 1. */
export function amountScaleFromHeader(header: string): number {
  const h = String(header ?? "").replace(/\s/g, "");
  if (/조원/.test(h)) return 1_000_000_000_000;
  if (/억원|억\)/.test(h)) return 100_000_000;
  if (/백만원/.test(h)) return 1_000_000;
  if (/천원/.test(h)) return 1_000;
  return 1;
}

function canonicalizeRow(row: Record<string, string>): CanonicalizedRow {
  const canonical: CanonicalRow = new Map();
  const amountScales = new Map<string, number>();
  for (const [header, value] of Object.entries(row)) {
    const field = canonicalFieldForHeader(header);
    if (!field) continue;
    const normalized = normalizeOptionalText(value);
    if (normalized === null) continue;
    const bucket = canonical.get(field) ?? [];
    canonical.set(field, [...bucket, normalized]);
    if (AMOUNT_FIELDS.has(field) && !amountScales.has(field)) {
      amountScales.set(field, amountScaleFromHeader(header));
    }
  }
  return { canonical, amountScales };
}

function firstOf(canonical: CanonicalRow, field: string): string | null {
  return canonical.get(field)?.[0] ?? null;
}

/**
 * 금액을 파싱하되, 값에 단위 문자(조/억/만)가 없으면 헤더 단위 스케일을 적용한다.
 * 값에 이미 단위가 있으면(예 "300억") 스케일을 무시해 이중 적용을 막는다.
 */
function parseKrwAmountScaled(value: string | null, scale: number): number | null {
  const base = parseKrwAmount(value);
  if (base === null) return null;
  const hadUnit = /[조억만]/.test(String(value ?? ""));
  return hadUnit ? base : Math.round(base * scale);
}

/**
 * 헤더→값 객체 하나를 canonical 필드로 정규화한다.
 * source가 kvca이면 펀드명/조합명을 상호 보완한다.
 */
export function normalizeSnapshotRow(
  row: Record<string, string>,
  options: { source: "kvic" | "kvca" | "tips" | "manual"; rowIndex: number },
): NormalizedSnapshotRow {
  const { canonical, amountScales } = canonicalizeRow(row);

  // 조합명은 fundName/associationName 양쪽 별칭이라 소스 무관하게 상호 보완한다.
  // (벤처투자조합 = 펀드. 자조합 현황은 조합명만, KVCA는 조합명, FundFinder는 펀드명)
  let fundName = firstOf(canonical, "fundName") ?? firstOf(canonical, "associationName");
  let associationName = firstOf(canonical, "associationName") ?? fundName;

  const fields: NormalizedSnapshotRow = {
    rowIndex: options.rowIndex,
    fundName,
    associationName,
    asctId: firstOf(canonical, "asctId"),
    investorNames: splitNames(firstOf(canonical, "investorNames")),
    investorType: firstOf(canonical, "investorType"),
    formedDate: normalizeDate(firstOf(canonical, "formedDate")),
    registeredDate: normalizeDate(firstOf(canonical, "registeredDate")),
    expiryDate: normalizeDate(firstOf(canonical, "expiryDate")),
    durationText: firstOf(canonical, "durationText"),
    committedAmountKrw: parseKrwAmountScaled(
      firstOf(canonical, "committedAmountKrw"),
      amountScales.get("committedAmountKrw") ?? 1,
    ),
    investedAmountKrw: parseKrwAmountScaled(
      firstOf(canonical, "investedAmountKrw"),
      amountScales.get("investedAmountKrw") ?? 1,
    ),
    mfundInvestedKrw: parseKrwAmountScaled(
      firstOf(canonical, "mfundInvestedKrw"),
      amountScales.get("mfundInvestedKrw") ?? 1,
    ),
    investmentPurpose: firstOf(canonical, "investmentPurpose"),
    investmentField: firstOf(canonical, "investmentField"),
    categoryCode: firstOf(canonical, "categoryCode"),
    categoryName: firstOf(canonical, "categoryName"),
    subcategoryCode: firstOf(canonical, "subcategoryCode"),
    subcategoryName: firstOf(canonical, "subcategoryName"),
    sectorKeyword: firstOf(canonical, "sectorKeyword"),
    startupStage: normalizeStage(firstOf(canonical, "startupStage")),
    region: firstOf(canonical, "region"),
    purposeType: firstOf(canonical, "purposeType"),
    supportType: firstOf(canonical, "supportType"),
    accountType: firstOf(canonical, "accountType"),
    representativeFundManager: firstOf(canonical, "representativeFundManager"),
    warnings: [],
  };

  return { ...fields, warnings: rowWarnings(fields, canonical, options.source) };
}

function rowWarnings(
  fields: NormalizedSnapshotRow,
  canonical: CanonicalRow,
  source: string,
): string[] {
  const warnings: string[] = [];
  if (!fields.fundName) {
    warnings.push(`Row ${fields.rowIndex}: 펀드/조합명이 없습니다.`);
  }
  if (source === "kvca" && fields.investorNames.length === 0) {
    warnings.push(`Row ${fields.rowIndex}: 운용사명이 없습니다.`);
  }
  const amountFields: Array<[keyof NormalizedSnapshotRow, string]> = [
    ["committedAmountKrw", "committedAmountKrw"],
    ["investedAmountKrw", "investedAmountKrw"],
    ["mfundInvestedKrw", "mfundInvestedKrw"],
  ];
  for (const [field, canonicalField] of amountFields) {
    const raw = firstOf(canonical, canonicalField);
    if (raw && fields[field] === null) {
      warnings.push(`Row ${fields.rowIndex}: ${canonicalField} 금액 파싱 실패: ${raw}`);
    }
  }
  const dateFields = ["formedDate", "registeredDate", "expiryDate"] as const;
  for (const field of dateFields) {
    const raw = firstOf(canonical, field);
    if (raw && fields[field] === null) {
      warnings.push(`Row ${fields.rowIndex}: ${field} 날짜 파싱 실패: ${raw}`);
    }
  }
  return warnings;
}
