# Homebrew formula 템플릿.
# 릴리스 후 moonklabs/homebrew-tap 저장소의 Formula/vc-funds.rb로 복사하고
# 버전과 sha256 플레이스홀더를 치환한다.
class VcFunds < Formula
  desc "VC/AC 공시정보와 창업자 가이드를 로컬 DB/MCP로 조회하는 CLI"
  homepage "https://github.com/moonklabs/vc-fund-disclosure"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-darwin-arm64"
      sha256 "REPLACE_WITH_DARWIN_ARM64_SHA256"
    else
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-darwin-x64"
      sha256 "REPLACE_WITH_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-linux-arm64"
      sha256 "REPLACE_WITH_LINUX_ARM64_SHA256"
    else
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-linux-x64"
      sha256 "REPLACE_WITH_LINUX_X64_SHA256"
    end
  end

  def install
    binary = Dir["vc-funds-*"].first
    bin.install binary => "vc-funds"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/vc-funds --version")
  end
end
