# 수집 경계 정책

이 도구는 **사용자가 직접 확보한 자료의 개인적 보관·검색**을 위한 것이다. 외부 사이트 자동 순회는 기본값으로 제공하지 않는다.

## 기본 ON (사용자 주도 수집)

| 플래그 | 설명 |
|---|---|
| `manual_snapshot_import` | 사용자가 브라우저에서 저장한 HTML/CSV/XLS 파일 import |
| `watch_folder_import` | Inbox 폴더에 저장된 PDF/HWPX/HTML 자동 import |
| `browser_capture_import` | 사용자가 보고 있는 페이지의 snapshot import (로드맵) |
| `guide_library_import` | Guides 폴더에 저장한 공식 가이드 PDF/HWPX import |

## 기본 OFF (허가 필요)

| 플래그 | 조건 |
|---|---|
| `official_feed_fetch` | KVIC/KVCA 공식 허가, 제휴, 유료 계약 후에만 활성화 |
| `site_background_crawler` | **초기 버전에서 금지** — `setPolicyFlag`가 코드 레벨에서 거부(`PolicyViolationError`). robots.txt/저작권/개인정보 검토를 거친 별도 릴리스에서만 재검토 |

## 원격 자료 취급

- 사라진 링크(예: HTTP 410 Gone)는 자동 다운로드 대상에 넣지 않는다.
- `vc-funds guide-source add --access-status remote_gone_410`으로 URL 후보만 기록하고, 사용자가 로컬 파일을 보유한 경우에만 `import guide`를 실행한다.
- 가이드 원문은 요약·체크리스트 용도로 활용하고, 전체 재출력하지 않는다.

## 데이터 위치

로컬 DB와 보관함은 모두 개인 장비 안에 둔다. 외부 전송은 사용자가 명시적으로 수행하는 경우에만 발생한다.
