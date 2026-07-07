# 수집 경계 정책

이 도구는 **사용자가 직접 확보한 자료의 개인적 보관·검색**을 위한 것이다. 외부 사이트 자동 순회는 기본값으로 제공하지 않는다.

## 기본 ON (사용자 주도 수집)

| 플래그 | 설명 |
|---|---|
| `manual_snapshot_import` | 사용자가 브라우저에서 저장한 HTML/CSV/XLS 파일 import |
| `watch_folder_import` | Inbox 폴더에 저장된 PDF/HWPX/HTML 자동 import |
| `browser_capture_import` | 사용자가 보고 있는 페이지의 snapshot import (로드맵) |
| `guide_library_import` | Guides 폴더에 저장한 공식 가이드 PDF/HWPX import |

## 기본 OFF (동의/허가 필요)

| 플래그 | 조건 |
|---|---|
| `on_demand_fetch` | **사용자 명령 실행 시에만** 공시 페이지를 조회하는 온디맨드 fetch (`vc-funds fetch kvic` = KVIC FundFinder, `vc-funds fetch diva` = KVCA DIVA 법정 공시). 두 사이트 모두 robots.txt가 `Disallow: /`이므로 고지문 확인 후 `--consent`로 사용자가 직접 동의해야 활성화되며, 동의는 공유된다. 요청 간 지연(rate limit)을 두고, 원본은 로컬에만 보관하며 재배포하지 않는다. 백그라운드 실행·스케줄링은 하지 않는다. |
| `official_feed_fetch` | KVIC/KVCA 공식 허가, 제휴, 유료 계약 후에만 활성화 |
| `site_background_crawler` | **초기 버전에서 금지** — `setPolicyFlag`가 코드 레벨에서 거부(`PolicyViolationError`). robots.txt/저작권/개인정보 검토를 거친 별도 릴리스에서만 재검토 |

## 게이트 없이 허용 (공인 개방 데이터)

- `vc-funds fetch datago`: 공공데이터포털(data.go.kr) 오픈API 수집. 공식 개방 데이터(라이선스 "이용허락범위 제한 없음")이며 활용신청으로 발급받은 serviceKey 제공 자체가 공식 허가에 해당하므로 동의 게이트 대상이 아니다. KVIC preset(자조합 운용사정보/자조합 현황/업력별·지역별 실적)은 odcloud API로 수집한다. 파일 직다운로드는 신형 데이터셋에서 JS 검증으로 차단되므로 사용하지 않는다.
- `vc-funds import seed`: data.go.kr 자조합 운용사정보를 바이너리에 임베드한 오프라인 시드.

## 소스별 신뢰·성격 요약

| 소스 | 성격 | 게이트 |
|---|---|---|
| KVIC FundFinder | 모태 출자 "투자가능 조합" 목록 | on_demand_fetch (robots) |
| KVCA DIVA | 결성/변경/해산 **법정 전자공시** | on_demand_fetch (robots) |
| data.go.kr (odcloud) | KVIC 공인 개방 데이터 | 없음 (serviceKey=허가) |
| 번들 시드 | 오프라인 개방 데이터 사본 | 없음 |

## 원격 자료 취급

- 사라진 링크(예: HTTP 410 Gone)는 자동 다운로드 대상에 넣지 않는다.
- `vc-funds guide-source add --access-status remote_gone_410`으로 URL 후보만 기록하고, 사용자가 로컬 파일을 보유한 경우에만 `import guide`를 실행한다.
- 가이드 원문은 요약·체크리스트 용도로 활용하고, 전체 재출력하지 않는다.

## 데이터 위치

로컬 DB와 보관함은 모두 개인 장비 안에 둔다. 외부 전송은 사용자가 명시적으로 수행하는 경우에만 발생한다.
