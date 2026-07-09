# vc-funds 설치 스크립트 (Windows PowerShell)
# 사용법: irm https://raw.githubusercontent.com/moonklabs/vc-fund-disclosure/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "moonklabs/vc-fund-disclosure"
$InstallDir = if ($env:VC_FUNDS_INSTALL_DIR) { $env:VC_FUNDS_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".local\bin" }

if (-not [System.Environment]::Is64BitOperatingSystem) {
  Write-Error "32비트 Windows는 지원하지 않습니다."
  exit 1
}
# ARM64 포함 모든 64비트 Windows에 x64 바이너리를 배포한다 (에뮬레이션으로 실행됨).
# 네이티브 windows-arm64 빌드는 로드맵.
$Arch = "x64"

$Artifact = "vc-funds-windows-$Arch.exe"
$Url = "https://github.com/$Repo/releases/latest/download/$Artifact"

Write-Host "다운로드: $Url"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Dest = Join-Path $InstallDir "vc-funds.exe"
Invoke-WebRequest -Uri $Url -OutFile $Dest

# Windows Defender SmartScreen은 미서명 실행 파일을 인터넷 다운로드로 인식해
# 차단 배지(Zone.Identifier)를 붙인다. 코드사이닝 인증서 없이는 이 배지를
# 완전히 없앨 수 없으므로, 최초 실행 시 나오는 경고를 안내한다.
Unblock-File -Path $Dest -ErrorAction SilentlyContinue

Write-Host "설치 완료: $Dest"

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
  Write-Host "PATH에 $InstallDir 를 추가했습니다. 새 터미널을 열어야 적용됩니다."
} else {
  Write-Host "PATH에 이미 $InstallDir 가 있습니다."
}

Write-Host ""
Write-Host "처음 실행 시 'Windows에서 PC를 보호했습니다' 경고가 나오면:"
Write-Host "  추가 정보 클릭 -> 실행 을 선택하세요 (코드사이닝 인증서 발급 전까지 나타나는 정상 경고입니다)."
Write-Host ""
Write-Host "다음 단계 (새 터미널에서):"
Write-Host "  vc-funds setup --client claude --db auto"
Write-Host "  vc-funds doctor"
