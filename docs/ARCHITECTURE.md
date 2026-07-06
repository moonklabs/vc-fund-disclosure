# 아키텍처

## 모듈 구성

```
┌─────────────────────────────────────────────┐
│ packages/cli  (vc-funds)                     │
│  setup · doctor · import · query · ask ·     │
│  events · guide-source · watch · diff ·      │
│  mcp serve                                   │
└──────────────┬───────────────┬───────────────┘
               │               │
┌──────────────▼─────┐  ┌──────▼───────────────┐
│ packages/mcp        │  │ packages/core        │
│ stdio MCP server    │─▶│ DB(bun:sqlite)       │
│ 도구 6종            │  │ parse(hwpx/pdf/html) │
│                     │  │ chunk · search ·     │
│                     │  │ policy · paths       │
└─────────────────────┘  └──────────────────────┘
```

- **core**: 순수 데이터 계층. CLI/MCP 어디서든 재사용. 부수효과는 DB와 파일 읽기뿐.
- **cli**: 사용자 인터페이스 + 클라이언트 설정 관리(`~/.claude.json`, `~/.codex/config.toml`).
- **mcp**: `@modelcontextprotocol/sdk` 기반 stdio server. core의 검색 함수를 도구로 노출.

## 데이터 모델

| 테이블 | 성격 | 비고 |
|---|---|---|
| `disclosures` | 공시 evidence 원본 | sha256 중복 방지, `parse_status`: raw/parsed/failed |
| `investors`, `funds` | 정규화된 공시 엔티티 | v0.1은 스키마만 — 스냅샷→정규화 매핑은 로드맵 |
| `events` | 시간순 변화 기록 | snapshot_imported, new_fund 등 |
| `guides`, `guide_chunks` | 공식 가이드 코퍼스 | 청크 단위 FTS5 색인 |
| `guide_sources` | 원격 URL 후보 | 파일 import와 분리 (410 Gone 등 기록) |
| `meta` | 스키마 버전, 수집 정책 | |

**Evidence 분리 원칙**: MCP 응답은 `evidence_type` 필드로 `disclosure`(공시 근거) / `official_guide`(공식 가이드) / `user_note`(사용자 데이터)를 구분한다.

## 한국어 검색

FTS5 `trigram` tokenizer를 사용해 형태소 분석 없이 부분 문자열 매칭을 지원한다.

- 3문자 미만 질의 → LIKE 폴백
- 자연어 질문 → 공백/문장부호 기준 토큰화 후 3문자 이상 토큰을 `OR`로 결합
- external-content FTS(`content=`)이므로 원본 테이블과 트리거로 동기화

## 단일 바이너리 배포

`bun build --compile`로 런타임 포함 단일 실행 파일을 생성한다. 배포 채널은 Homebrew tap(`homebrew/vc-funds.rb`)과 GitHub Releases(`install.sh`)이며, npm 배포는 사용하지 않는다.

## 설계 결정 기록

1. **Bun + TypeScript 선택**: `bun:sqlite` 내장(의존성 제로), `--compile` 단일 바이너리, PDF/HWPX 파싱 생태계(unpdf/fflate)가 Go 대비 우수.
2. **정규화보다 원본 보존 우선**: KVIC/KVCA 화면 구조는 예고 없이 바뀌므로, v0.1은 원본 스냅샷 + 테이블 raw 추출을 보존하고 정규화 매핑은 별도 릴리스로 분리.
3. **MCP 등록의 NOT_READY 원칙**: 실행 파일을 해석할 수 없으면 클라이언트 설정을 건드리지 않는다. 설정 파일은 수정 전 항상 `.bak-<timestamp>` 백업을 만든다.
