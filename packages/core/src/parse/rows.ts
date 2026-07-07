/**
 * 스냅샷 테이블(HTML <table> 추출 결과 또는 CSV)을 헤더→값 레코드로 변환.
 * CSV 파서는 k-startup-plugins 스펙 팩 runtime/src/table-parser.mjs에서 이식.
 */

export interface SnapshotRows {
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
}

/**
 * parseHtmlSnapshot이 추출한 테이블들(행×열 배열) 중 데이터 테이블을 골라
 * 첫 행을 헤더로 레코드화한다. 헤더+데이터가 있는 가장 큰 테이블을 선택.
 */
export function recordsFromTables(tables: string[][][]): SnapshotRows {
  const candidates = tables.filter((table) => table.length >= 2 && (table[0]?.length ?? 0) >= 2);
  if (candidates.length === 0) {
    return { headers: [], rows: [], warnings: ["헤더와 데이터 행이 있는 테이블을 찾지 못했습니다."] };
  }
  const best = candidates.reduce((a, b) => (b.length * (b[0]?.length ?? 0) > a.length * (a[0]?.length ?? 0) ? b : a));
  const [headerRow, ...dataRows] = best;
  return recordsFromGrid(headerRow ?? [], dataRows);
}

/** CSV 텍스트를 레코드화한다. 따옴표/이스케이프("")/CRLF 지원. */
export function recordsFromCsv(text: string): SnapshotRows {
  const grid = parseCsvGrid(text);
  const [headerRow, ...dataRows] = grid;
  if (!headerRow || headerRow.length === 0) {
    return { headers: [], rows: [], warnings: ["CSV 헤더 행이 비어 있습니다."] };
  }
  return recordsFromGrid(headerRow, dataRows);
}

/**
 * KVIC FundFinder 목록은 펀드 1건이 "본행 + 투자목적 단독행" 2행 구조다.
 * 단독행(값이 첫 컬럼 하나뿐이고 숫자가 아님)을 직전 펀드 행의 `투자목적` 필드로 병합한다.
 * 헤더 2행째의 '투자목적' 서브헤더 잔여 행은 버린다.
 */
export function mergeKvicPurposeRows(records: SnapshotRows): SnapshotRows {
  const PURPOSE_HEADER = "투자목적";
  const merged: Array<Record<string, string>> = [];
  for (const row of records.rows) {
    const nonEmpty = Object.entries(row).filter(([, value]) => value.trim().length > 0);
    const single = (nonEmpty.length === 1 ? nonEmpty[0] : undefined) ?? null;
    const isContinuation =
      single !== null && single[0] === records.headers[0] && !/^\d+$/.test(single[1].trim());
    if (!isContinuation) {
      merged.push({ ...row });
      continue;
    }
    const text = single[1].trim();
    const prev = merged[merged.length - 1];
    if (!prev || text === PURPOSE_HEADER) continue;
    merged[merged.length - 1] = {
      ...prev,
      [PURPOSE_HEADER]: prev[PURPOSE_HEADER] ? `${prev[PURPOSE_HEADER]}, ${text}` : text,
    };
  }
  const headers = records.headers.includes(PURPOSE_HEADER)
    ? records.headers
    : [...records.headers, PURPOSE_HEADER];
  return { headers, rows: merged, warnings: records.warnings };
}

function recordsFromGrid(headerRow: string[], dataRows: string[][]): SnapshotRows {
  const headers = headerRow.map((h) => h.trim());
  const warnings: string[] = [];
  const rows = dataRows
    .filter((cells) => cells.some((cell) => cell.trim().length > 0))
    .map((cells, index) => {
      if (cells.length > headers.length) {
        warnings.push(`Row ${index + 1}: 셀 개수(${cells.length})가 헤더(${headers.length})보다 많습니다.`);
      }
      const record: Record<string, string> = {};
      headers.forEach((header, col) => {
        if (header) record[header] = (cells[col] ?? "").trim();
      });
      return record;
    });
  return { headers, rows, warnings };
}

function parseCsvGrid(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = (): void => {
    row.push(cell);
    cell = "";
  };
  const pushRow = (): void => {
    pushCell();
    grid.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) pushRow();
  return grid;
}
