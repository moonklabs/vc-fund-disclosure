# CLAUDE.md

Claude Code가 이 저장소에서 작업할 때 따르는 지침입니다.

## 릴리스 태그 푸시 사전 승인

`git push origin v<X.Y.Z>` 형태의 릴리스 태그 푸시는 아래 조건을 모두 만족하면 매번 확인받지 않고 진행합니다. 이 태그 푸시는 `.github/workflows/release.yml`을 트리거해 GitHub Release를 공개 게시하고 install.sh/install.ps1이 즉시 그 버전을 가리키게 만듭니다.

- 사용자가 이번 대화에서 해당 버전의 릴리스(태그 생성 포함)를 명시적으로 요청했음
- `CHANGELOG.md`에 해당 버전 항목이 이미 작성되어 있음
- `bun test`와 `bun run typecheck`가 통과함
- 관련 커밋이 이미 `origin/main`에 푸시되어 있음

이 사전 승인은 **릴리스 태그 push에만** 적용됩니다. `--force` push, `git reset --hard`, 브랜치/태그 삭제, 기존 태그 재푸시(overwrite) 등 되돌리기 어려운 다른 작업은 여전히 매번 명시적으로 확인받습니다.
