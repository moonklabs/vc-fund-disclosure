import { describe, expect, test } from "bun:test";
import { openDatabase } from "../src/db/database.ts";
import {
  DEFAULT_COLLECTION_POLICY,
  getPolicy,
  setPolicyFlag,
} from "../src/policy.ts";
import { PolicyViolationError } from "../src/errors.ts";

describe("openDatabase", () => {
  test("스키마 테이블이 모두 생성된다", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    for (const expected of [
      "meta",
      "investors",
      "funds",
      "disclosures",
      "events",
      "guides",
      "guide_chunks",
      "guide_sources",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  test("schema_version이 기록된다", () => {
    const db = openDatabase(":memory:");
    const row = db
      .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
      .get();
    expect(row?.value).toBe("2");
  });
});

describe("collection policy", () => {
  test("기본 정책: 수동 4종 ON, 자동수집 2종 OFF", () => {
    const db = openDatabase(":memory:");
    const policy = getPolicy(db);
    expect(policy).toEqual({ ...DEFAULT_COLLECTION_POLICY });
    expect(policy.official_feed_fetch).toBe(false);
    expect(policy.site_background_crawler).toBe(false);
  });

  test("site_background_crawler 활성화는 거부된다", () => {
    const db = openDatabase(":memory:");
    expect(() => setPolicyFlag(db, "site_background_crawler", true)).toThrow(PolicyViolationError);
  });

  test("정책 변경은 새 객체를 반환하고 영속화된다", () => {
    const db = openDatabase(":memory:");
    const next = setPolicyFlag(db, "official_feed_fetch", true);
    expect(next.official_feed_fetch).toBe(true);
    expect(DEFAULT_COLLECTION_POLICY.official_feed_fetch).toBe(false);
    expect(getPolicy(db).official_feed_fetch).toBe(true);
  });
});
