import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

/**
 * DB 파일을 열고(없으면 생성) 스키마를 적용한다.
 * - 신규 DB: 최신 스키마 생성 후 schema_version 기록
 * - 구버전 DB: MIGRATIONS의 ALTER를 순차 적용
 * 상위 디렉토리가 없으면 함께 생성한다.
 */
export function openDatabase(dbPath: string): Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // 구버전 DB는 ALTER를 먼저 적용해야 SCHEMA_SQL의 신규 인덱스가
  // 새 컬럼(name_normalized 등)을 참조할 수 있다.
  const existingVersion = readSchemaVersion(db);
  if (existingVersion !== null && existingVersion < SCHEMA_VERSION) {
    for (let version = existingVersion + 1; version <= SCHEMA_VERSION; version += 1) {
      for (const statement of MIGRATIONS[version] ?? []) {
        db.exec(statement);
      }
    }
  }
  db.exec(SCHEMA_SQL);
  setMeta(db, "schema_version", String(SCHEMA_VERSION));
  return db;
}

function readSchemaVersion(db: Database): number | null {
  const hasMeta = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
    .get();
  if (!hasMeta) return null;
  const row = db
    .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
    .get();
  const version = Number(row?.value);
  return Number.isFinite(version) ? version : null;
}

/** meta 테이블 단일 값 조회. */
export function getMeta(db: Database, key: string): string | null {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

/** meta 테이블 단일 값 저장(upsert). */
export function setMeta(db: Database, key: string, value: string): void {
  db.query(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
