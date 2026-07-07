import type { Database } from "bun:sqlite";
import { PolicyViolationError } from "./errors.ts";
import { getMeta, setMeta } from "./db/database.ts";

/** 수집 경계 정책. 기본 ON 4종, 기본 OFF 3종. */
export interface CollectionPolicy {
  manual_snapshot_import: boolean;
  watch_folder_import: boolean;
  browser_capture_import: boolean;
  guide_library_import: boolean;
  /**
   * 사용자가 직접 실행한 명령에서만 공시 페이지를 1회 조회하는 온디맨드 fetch.
   * 대상 사이트 robots.txt가 자동 수집을 불허하므로, 고지 후 사용자 동의로만 활성화된다.
   */
  on_demand_fetch: boolean;
  /** 공식 허가/제휴/유료 계약 후에만 활성화 */
  official_feed_fetch: boolean;
  /** 초기 버전에서는 활성화 금지 */
  site_background_crawler: boolean;
}

export const DEFAULT_COLLECTION_POLICY: Readonly<CollectionPolicy> = Object.freeze({
  manual_snapshot_import: true,
  watch_folder_import: true,
  browser_capture_import: true,
  guide_library_import: true,
  on_demand_fetch: false,
  official_feed_fetch: false,
  site_background_crawler: false,
});

const POLICY_META_KEY = "collection_policy";

export function getPolicy(db: Database): CollectionPolicy {
  const raw = getMeta(db, POLICY_META_KEY);
  if (!raw) return { ...DEFAULT_COLLECTION_POLICY };
  try {
    const parsed: unknown = JSON.parse(raw);
    return { ...DEFAULT_COLLECTION_POLICY, ...(parsed as Partial<CollectionPolicy>) };
  } catch {
    return { ...DEFAULT_COLLECTION_POLICY };
  }
}

/**
 * 정책 플래그를 변경한다. 새 정책 객체를 반환한다.
 * site_background_crawler는 초기 버전에서 활성화할 수 없다.
 */
export function setPolicyFlag(
  db: Database,
  key: keyof CollectionPolicy,
  value: boolean,
): CollectionPolicy {
  if (key === "site_background_crawler" && value) {
    throw new PolicyViolationError(
      "site_background_crawler는 초기 버전에서 활성화할 수 없습니다. robots/저작권 검토 후 별도 릴리스에서 지원됩니다.",
    );
  }
  const next: CollectionPolicy = { ...getPolicy(db), [key]: value };
  setMeta(db, POLICY_META_KEY, JSON.stringify(next));
  return next;
}

/** 무허가 수집 경로가 모두 비활성화 상태인지 확인한다 (doctor용). */
export function isPolicyCompliant(policy: CollectionPolicy): boolean {
  return !policy.site_background_crawler;
}
