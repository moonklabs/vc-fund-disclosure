# vc-fund-disclosure

VC/AC 투자사 공시정보(KVIC FundFinder, KVCA DIVA, TIPS)와 초기 창업자용 투자유치 가이드(PDF/HWPX)를 **개인 로컬 SQLite DB**에 축적하고, Claude/Codex에서 `vc-fund-disclosure` MCP로 조회하는 도구입니다.

## 구조

사용자에게는 하나의 CLI(`vc-funds`)로 보이고, 내부는 세 모듈로 나뉩니다.

| 패키지 | 역할 |
|---|---|
| `packages/core` (`vc-fund-disclosure-core`) | HTML/CSV/PDF/HWPX import·정규화, 가이드 chunking, FTS 검색, 수집 정책 |
| `packages/cli` (`vc-funds`) | setup, doctor, import, query, ask, events, guide-source, watch, mcp serve |
| `packages/mcp` (`vc-fund-disclosure-mcp`) | stdio MCP server — 펀드 근거·창업자 가이드 검색 도구 6종 |

## 개발 환경

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # bun:test
bun run build       # 단일 실행 파일 → dist/vc-funds
bun run dev -- doctor   # 개발 모드 실행
```

## 설치 (배포 후 목표 UX)

```bash
brew install moonklabs/tap/vc-funds
vc-funds setup --client claude --db auto
vc-funds doctor
```

Homebrew를 쓰지 않는 경우:

```bash
curl -fsSL https://raw.githubusercontent.com/moonklabs/vc-fund-disclosure/main/install.sh | sh
```

`setup`은 다음 7단계를 자동 처리합니다: ① SQLite DB 생성 ② 보관함(Archive) ③ guide library(Guides) ④ watch folder(Inbox) ⑤ Claude/Codex MCP 설정 등록 ⑥ 설정 백업 ⑦ doctor 실행.

실행 파일을 해석할 수 없으면 MCP 설정을 **등록하지 않고 NOT_READY**로 표시합니다.

## 기본 경로

| 항목 | macOS/Linux | Windows |
|---|---|---|
| DB | `~/.local/share/moonklabs/vc-funds/vc-funds.sqlite` | `%LOCALAPPDATA%\MoonkLabs\vc-funds\vc-funds.sqlite` |
| Inbox | `~/Documents/MoonkLabs/VC Disclosures/Inbox` | `%USERPROFILE%\Documents\MoonkLabs\VC Disclosures\Inbox` |
| Archive | `~/Documents/MoonkLabs/VC Disclosures/Archive` | 〃 `\Archive` |
| Guides | `~/Documents/MoonkLabs/VC Disclosures/Guides` | 〃 `\Guides` |

환경변수 override: `VC_FUNDS_DB`, `VC_FUNDS_DISCLOSURE_DIR`, `VC_FUNDS_HOME`

## 사용 예

```bash
vc-funds import kvic --file "./snapshots/fundfinder-AA02.html" --group AA --code AA02
vc-funds import kvca --file "./snapshots/kvca-primer.html"
vc-funds import document --file "./disclosures/new-fund.hwpx" --source kvca
vc-funds import guide --file "./guides/seed-fundraising-guide.pdf" --role founder_education
vc-funds query investor "프라이머"
vc-funds ask "처음 투자유치할 때 무엇부터 준비해야 해?"
vc-funds events --since 2026-01-01
vc-funds watch          # Inbox/Guides 자동 import 감시
vc-funds mcp serve      # stdio MCP server (보통 클라이언트가 자동 기동)
```

원격 링크가 사라진 가이드는 URL 후보와 파일 import를 분리합니다:

```bash
vc-funds guide-source add \
  --publisher KVIC \
  --url "https://www.kvic.or.kr/upload/investment/20210114/20210114155945_63291.pdf" \
  --access-status remote_gone_410
```

## 수집 경계 (기본 정책)

- **기본 ON**: `manual_snapshot_import`, `watch_folder_import`, `browser_capture_import`, `guide_library_import`
- **기본 OFF**: `official_feed_fetch` (공식 허가·제휴 후에만), `site_background_crawler` (**초기 버전 활성화 금지** — 코드 레벨에서 거부)

자세한 내용: [docs/COLLECTION_POLICY.md](docs/COLLECTION_POLICY.md)

## v0.1 구현 상태 및 로드맵

| 기능 | 상태 |
|---|---|
| SQLite 스키마(v2, 마이그레이션 지원) + FTS5(trigram) 한국어 검색 | ✅ |
| HTML/CSV 스냅샷 / HWPX / PDF / 텍스트 import | ✅ (PDF는 unpdf 기반, 스캔본 OCR 미지원) |
| KVIC/KVCA 테이블 → funds/investors/operator links 정규화 | ✅ v0.2.0 (한국어 별칭 사전, 조/억/만 금액, new_fund 이벤트, quality flags) |
| 가이드 chunking + `ask` 근거 검색 | ✅ |
| watch folder (Inbox→Archive 이동, Guides 색인) | ✅ |
| MCP server (도구 6종) + Claude/Codex 설정 등록 | ✅ |
| GitHub Releases 배포 + install.sh | ✅ |
| retrieval 계층 (resolve/rank/evidence gate, 도구명 계약 정렬) | ⬜ v0.3.0 — [docs/contracts](docs/contracts/) 기준 |
| `diff` (스냅샷 간 신규/변경 펀드) | ⬜ 로드맵 |
| XLS/XLSX 파싱 | ⬜ 로드맵 |
| doctor의 MCP handshake 자동검사 | ⬜ 로드맵 |
| browser capture import | ⬜ 로드맵 |
| Homebrew tap | ⬜ 로드맵 (formula 템플릿 포함) |

계약 문서: [docs/contracts/](docs/contracts/) — `moonklabs/k-startup-plugins` 스펙 팩에서 이관한 canonical 계약 (이 리포가 공식 구현체).

## License

MIT © MoonkLabs
