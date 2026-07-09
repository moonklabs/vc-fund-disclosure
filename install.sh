#!/bin/sh
# vc-funds 설치 스크립트 (Homebrew 미사용 환경용)
# 사용법: curl -fsSL https://raw.githubusercontent.com/moonklabs/vc-fund-disclosure/main/install.sh | sh
set -eu

REPO="moonklabs/vc-fund-disclosure"
INSTALL_DIR="${VC_FUNDS_INSTALL_DIR:-$HOME/.local/bin}"

os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Darwin) platform="darwin" ;;
  Linux)  platform="linux" ;;
  *) echo "지원하지 않는 OS입니다: $os" >&2; exit 1 ;;
esac

case "$arch" in
  arm64|aarch64) cpu="arm64" ;;
  x86_64|amd64)  cpu="x64" ;;
  *) echo "지원하지 않는 아키텍처입니다: $arch" >&2; exit 1 ;;
esac

artifact="vc-funds-${platform}-${cpu}"
url="https://github.com/${REPO}/releases/latest/download/${artifact}"

echo "다운로드: $url"
mkdir -p "$INSTALL_DIR"
curl -fSL "$url" -o "$INSTALL_DIR/vc-funds"
chmod +x "$INSTALL_DIR/vc-funds"

# macOS: 다운로드 격리(quarantine)와 ad-hoc 서명 문제를 자동 해소한다.
# 미처리 시 Apple Silicon에서 Gatekeeper가 실행을 SIGKILL(exit 137)로 차단한다.
if [ "$platform" = "darwin" ]; then
  xattr -d com.apple.quarantine "$INSTALL_DIR/vc-funds" 2>/dev/null || true
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$INSTALL_DIR/vc-funds" 2>/dev/null || true
  fi
fi

echo "설치 완료: $INSTALL_DIR/vc-funds"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "주의: $INSTALL_DIR 가 PATH에 없습니다. 셸 설정에 추가하세요." ;;
esac

echo "다음 단계:"
echo "  vc-funds setup --client claude --db auto"
echo "  vc-funds doctor"
