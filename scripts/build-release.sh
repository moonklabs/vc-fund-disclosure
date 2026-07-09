#!/bin/sh
# 릴리스용 크로스 타깃 바이너리 빌드.
# 사용법: sh scripts/build-release.sh
# 산출물: dist/release/vc-funds-<target> (+ .exe for windows), SHA256SUMS.txt
set -eu

cd "$(dirname "$0")/.."

ENTRY=packages/cli/src/index.ts
OUT=dist/release
mkdir -p "$OUT"

build() {
  target="$1"
  outfile="$2"
  echo "=== build $outfile (target=$target) ==="
  bun build --compile --minify --target="$target" "$ENTRY" --outfile "$OUT/$outfile"
}

build bun-darwin-arm64  vc-funds-darwin-arm64
build bun-darwin-x64    vc-funds-darwin-x64
build bun-linux-arm64   vc-funds-linux-arm64
build bun-linux-x64     vc-funds-linux-x64
build bun-windows-x64   vc-funds-windows-x64.exe

# macOS 바이너리는 로컬 검증 시 ad-hoc 재서명해야 즉시 실행 가능하다
# (다운로드본은 install.sh가 자동으로 처리한다).
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$OUT/vc-funds-darwin-arm64" 2>/dev/null || true
  codesign --force --sign - "$OUT/vc-funds-darwin-x64" 2>/dev/null || true
fi

(cd "$OUT" && shasum -a 256 vc-funds-* > SHA256SUMS.txt)

echo ""
echo "=== 산출물 ==="
ls -la "$OUT"
cat "$OUT/SHA256SUMS.txt"
