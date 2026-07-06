# 계약 문서 (Contracts)

이 디렉토리의 계약 문서는 `moonklabs/k-startup-plugins` 리포의
`startup-fundraise/mcp/vc-fund-disclosure/` 스펙 팩(커밋 `cf21087`)에서 이관한 canonical 계약입니다.
이 리포(vc-fund-disclosure)가 해당 스펙 팩의 공식 구현체입니다.

| 파일 | 역할 | 구현 상태 |
|---|---|---|
| `source-registry.yaml` | 수집 source, trust tier, robots/정책 상태, 필수 필드 | v0.2.0 부분 반영 (소스별 import) |
| `tool-contract.yaml` | MCP tool surface와 사용자 표시 계약 | v0.3.0 예정 (도구명 정렬 포함) |
| `search-contract.yaml` | intent 라우팅, 랭킹 모델, evidence status | v0.3.0 예정 |
| `data-trust-resolution-contract.yaml` | trust tier(T0~T9), answer gate, resolution pipeline | v0.3.0 예정 |

원칙: 구현이 계약과 달라지면 계약을 먼저 수정하고 코드가 따른다.
계약에 없는 도구/필드를 임의로 추가하지 않는다.
