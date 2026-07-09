# Homebrew formula 템플릿.
# 릴리스 후 moonklabs/homebrew-tap 저장소의 Formula/vc-funds.rb로 복사하고
# 버전과 sha256 플레이스홀더를 치환한다.
class VcFunds < Formula
  desc "VC/AC 공시정보와 창업자 가이드를 로컬 DB/MCP로 조회하는 CLI"
  homepage "https://github.com/moonklabs/vc-fund-disclosure"
  version "0.4.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-darwin-arm64"
      sha256 "b7854fe3992a3888c050921f5c56d736930f8b771602d7abef48f15322483952"
    else
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-darwin-x64"
      sha256 "dbbcf75fac100195c75b12b7193d4c84b6b4d52f14edf7aaf5753f52cff32016"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-linux-arm64"
      sha256 "f3bb4cb7166488bf105474e9c3f1b606cfd0d657a3ca66291805add34931fabb"
    else
      url "https://github.com/moonklabs/vc-fund-disclosure/releases/download/v#{version}/vc-funds-linux-x64"
      sha256 "433fe07b45a8f9e9a5925e4e5b86d63c3156eccc053722d420d7b029d76f01c2"
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
