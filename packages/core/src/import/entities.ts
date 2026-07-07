import type { Database } from "bun:sqlite";
import { normalizeKey } from "../normalize/text.ts";
import type { NormalizedSnapshotRow } from "../normalize/fields.ts";

export interface EntityImportCounters {
  funds: number;
  newFunds: number;
  investors: number;
  operatorLinks: number;
  focusRows: number;
  qualityFlags: number;
}

export interface EntityImportContext {
  source: "kvic" | "kvca" | "tips" | "manual";
  disclosureId: number;
  capturedAt: string;
}

/**
 * 정규화된 스냅샷 행들을 investors/funds/fund_operator_links/
 * fund_investment_focus/data_quality_flags로 upsert한다.
 * 신규 펀드에는 new_fund 이벤트를 남긴다.
 */
export function upsertSnapshotEntities(
  db: Database,
  rows: NormalizedSnapshotRow[],
  context: EntityImportContext,
): EntityImportCounters {
  const counters: EntityImportCounters = {
    funds: 0,
    newFunds: 0,
    investors: 0,
    operatorLinks: 0,
    focusRows: 0,
    qualityFlags: 0,
  };

  const run = db.transaction(() => {
    for (const row of rows) {
      importRow(db, row, context, counters);
    }
  });
  run();
  return counters;
}

function importRow(
  db: Database,
  row: NormalizedSnapshotRow,
  context: EntityImportContext,
  counters: EntityImportCounters,
): void {
  if (!row.fundName) {
    // 펀드명이 없는 소스(예: data.go.kr 운용사 목록)는 운용사만 upsert한다.
    for (const investorName of row.investorNames) {
      upsertInvestor(db, investorName, context);
      counters.investors += 1;
    }
    insertQualityFlags(db, row.warnings, {
      entityType: "disclosure",
      entityId: context.disclosureId,
      severity: row.investorNames.length > 0 ? "warning" : "critical",
      context,
    });
    counters.qualityFlags += row.warnings.length;
    return;
  }

  const fundNameKey = normalizeKey(row.fundName);
  const existingFund = db
    .query<{ id: number }, [string, string]>(
      "SELECT id FROM funds WHERE name_normalized = ? AND source = ?",
    )
    .get(fundNameKey, context.source);

  const fund = db
    .query<{ id: number }, (string | number | null)[]>(
      `INSERT INTO funds (
         name, name_normalized, code, source, formed_date, registered_date, expiry_date,
         committed_amount_krw, invested_amount_krw, mfund_invested_krw,
         duration_text, investment_purpose, trust_level, latest_evidence_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official_snapshot', ?)
       ON CONFLICT(name_normalized, source) DO UPDATE SET
         name = excluded.name,
         code = COALESCE(excluded.code, funds.code),
         formed_date = COALESCE(excluded.formed_date, funds.formed_date),
         registered_date = COALESCE(excluded.registered_date, funds.registered_date),
         expiry_date = COALESCE(excluded.expiry_date, funds.expiry_date),
         committed_amount_krw = COALESCE(excluded.committed_amount_krw, funds.committed_amount_krw),
         invested_amount_krw = COALESCE(excluded.invested_amount_krw, funds.invested_amount_krw),
         mfund_invested_krw = COALESCE(excluded.mfund_invested_krw, funds.mfund_invested_krw),
         duration_text = COALESCE(excluded.duration_text, funds.duration_text),
         investment_purpose = COALESCE(excluded.investment_purpose, funds.investment_purpose),
         trust_level = excluded.trust_level,
         latest_evidence_at = excluded.latest_evidence_at
       RETURNING id`,
    )
    .get(
      row.fundName,
      fundNameKey,
      row.asctId,
      context.source,
      row.formedDate,
      row.registeredDate,
      row.expiryDate,
      row.committedAmountKrw,
      row.investedAmountKrw,
      row.mfundInvestedKrw,
      row.durationText,
      row.investmentPurpose ?? row.investmentField,
      context.capturedAt,
    );
  if (!fund) throw new Error(`fund upsert 실패: ${row.fundName}`);
  counters.funds += 1;

  if (!existingFund) {
    counters.newFunds += 1;
    db.query(
      `INSERT INTO events (disclosure_id, event_type, entity, summary, occurred_at)
       VALUES (?, 'new_fund', ?, ?, ?)`,
    ).run(
      context.disclosureId,
      row.fundName,
      `신규 펀드 발견: ${row.fundName}${row.investorNames.length > 0 ? ` (운용: ${row.investorNames.join(", ")})` : ""}`,
      row.formedDate ?? row.registeredDate,
    );
  }

  for (const investorName of row.investorNames) {
    const investor = upsertInvestor(db, investorName, context);
    counters.investors += 1;

    db.query(
      `INSERT INTO fund_operator_links (fund_id, investor_id, role, disclosure_id, confidence)
       VALUES (?, ?, 'operator', ?, 'high')
       ON CONFLICT(fund_id, investor_id, role) DO UPDATE SET
         disclosure_id = excluded.disclosure_id,
         confidence = excluded.confidence`,
    ).run(fund.id, investor.id, context.disclosureId);
    counters.operatorLinks += 1;
  }

  const hasFocus = [
    row.categoryCode,
    row.subcategoryCode,
    row.categoryName,
    row.subcategoryName,
    row.sectorKeyword,
    row.startupStage,
    row.region,
    row.investmentField,
  ].some(Boolean);
  if (hasFocus) {
    const categoryName = row.categoryName ?? row.investmentField;
    const sectorKeyword = row.sectorKeyword ?? row.investmentField;
    // UNIQUE 인덱스는 NULL을 서로 다른 값으로 취급하므로 존재 확인 후 삽입한다.
    const focusExists = db
      .query<{ id: number }, (string | number | null)[]>(
        `SELECT id FROM fund_investment_focus
         WHERE fund_id = ?
           AND IFNULL(category_code, '') = IFNULL(?, '')
           AND IFNULL(category_name, '') = IFNULL(?, '')
           AND IFNULL(subcategory_name, '') = IFNULL(?, '')
           AND IFNULL(sector_keyword, '') = IFNULL(?, '')
           AND IFNULL(startup_stage, '') = IFNULL(?, '')`,
      )
      .get(fund.id, row.categoryCode, categoryName, row.subcategoryName, sectorKeyword, row.startupStage);
    if (!focusExists) {
      db.query(
        `INSERT INTO fund_investment_focus (
           fund_id, category_code, subcategory_code, category_name, subcategory_name,
           sector_keyword, startup_stage, region, disclosure_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        fund.id,
        row.categoryCode,
        row.subcategoryCode,
        categoryName,
        row.subcategoryName,
        sectorKeyword,
        row.startupStage,
        row.region,
        context.disclosureId,
      );
      counters.focusRows += 1;
    }
  }

  if (row.warnings.length > 0) {
    insertQualityFlags(db, row.warnings, {
      entityType: "fund",
      entityId: fund.id,
      severity: "warning",
      context,
    });
    counters.qualityFlags += row.warnings.length;
  }
}

function upsertInvestor(
  db: Database,
  investorName: string,
  context: EntityImportContext,
): { id: number } {
  const investor = db
    .query<{ id: number }, [string, string, string, string]>(
      `INSERT INTO investors (name, name_normalized, type, source, trust_level, latest_evidence_at)
       VALUES (?, ?, 'VC/AC', ?, 'official_snapshot', ?)
       ON CONFLICT(name_normalized, source) DO UPDATE SET
         name = excluded.name,
         trust_level = excluded.trust_level,
         latest_evidence_at = excluded.latest_evidence_at
       RETURNING id`,
    )
    .get(investorName, normalizeKey(investorName), context.source, context.capturedAt);
  if (!investor) throw new Error(`investor upsert 실패: ${investorName}`);
  return investor;
}

function insertQualityFlags(
  db: Database,
  warnings: string[],
  options: {
    entityType: string;
    entityId: number;
    severity: "critical" | "warning";
    context: EntityImportContext;
  },
): void {
  const insert = db.query(
    `INSERT INTO data_quality_flags (entity_type, entity_id, severity, flag_type, message, source, disclosure_id)
     VALUES (?, ?, ?, 'snapshot_import_warning', ?, ?, ?)
     ON CONFLICT(entity_type, entity_id, message) DO UPDATE SET
       severity = excluded.severity,
       disclosure_id = excluded.disclosure_id`,
  );
  for (const warning of warnings) {
    insert.run(
      options.entityType,
      options.entityId,
      options.severity,
      warning,
      options.context.source,
      options.context.disclosureId,
    );
  }
}
