import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

/**
 * DB 파일을 열고(없으면 생성) 스키마를 적용한다.
 * 상위 디렉토리가 없으면 함께 생성한다.
 */
export function openDatabase(dbPath: string): Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  db.query(
    "INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING",
  ).run(String(SCHEMA_VERSION));
  return db;
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
