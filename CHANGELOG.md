# Changelog

이 프로젝트의 주요 변경사항을 기록합니다. 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [0.4.2] - 2026-07-09

### Fixed
- **투자사 검색 중복 병합**: `search_investors`가 KVIC/KVCA 공시처별로 중복 적재된
  동일 회사를 개별 행으로 반환하던 문제를 회사 단위(`name_normalized`) 롤업으로 해결.
  - canonical(대표) 행 선정: 펀드 연결 보유 → 구체 업종 유형 → 최신 근거 → id 순
  - 응답에 `sources[]`, `evidence_count` 필드 추가 (복수 공시처 = 교차검증 신호)
  - `limit`은 롤업 이후 회사 수 기준으로 적용
  - 공시 근거 행은 삭제하지 않고 표시 계층에서만 병합하여 provenance 보존

### Changed
- **`install.sh` macOS 하드닝**: 다운로드 후 `com.apple.quarantine` 제거 및
  ad-hoc 재서명(`codesign --force --sign -`)을 자동 수행. Apple Silicon에서
  Gatekeeper가 실행을 SIGKILL(exit 137)로 차단하던 신규 사용자 온보딩 블로커 해소.

## [0.4.1] - 2026-07-07

- 자조합 현황 1,216개 수집, 금액 단위 스케일 정규화.
