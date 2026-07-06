export { VERSION } from "./version.ts";
export { NotImplementedError, PolicyViolationError } from "./errors.ts";
export { defaultPaths, type AppPaths, type PathOverrides } from "./paths.ts";
export { openDatabase, getMeta, setMeta } from "./db/database.ts";
export { SCHEMA_SQL, SCHEMA_VERSION } from "./db/schema.ts";
export {
  DEFAULT_COLLECTION_POLICY,
  getPolicy,
  setPolicyFlag,
  isPolicyCompliant,
  type CollectionPolicy,
} from "./policy.ts";
export { sha256Hex } from "./hash.ts";
export { chunkText, type ChunkOptions } from "./chunk/chunker.ts";
export { extractHwpxText } from "./parse/hwpx.ts";
export { extractPdfText } from "./parse/pdf.ts";
export { parseHtmlSnapshot, type HtmlSnapshot } from "./parse/html.ts";
export { detectKind, extractDocumentText, type DocumentKind } from "./parse/document.ts";
export {
  importHtmlSnapshot,
  type SnapshotImportInput,
  type SnapshotImportResult,
} from "./import/snapshot.ts";
export {
  importDisclosureDocument,
  type DocumentImportInput,
  type DocumentImportResult,
} from "./import/document.ts";
export { importGuide, type GuideImportInput, type GuideImportResult, type GuideRole } from "./import/guide.ts";
export {
  addGuideSource,
  listGuideSources,
  type GuideSourceInput,
  type GuideSourceRow,
  type GuideAccessStatus,
} from "./import/guide-source.ts";
export {
  searchGuides,
  searchInvestors,
  searchFunds,
  listEvents,
  getDbStatus,
  type GuideSearchHit,
  type InvestorRow,
  type FundRow,
  type EventRow,
  type DbStatus,
} from "./search.ts";
