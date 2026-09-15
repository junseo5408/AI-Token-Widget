# winCodeSign 캐시를 미리 만들어 둔다.
#
# electron-builder 는 빌드 중 winCodeSign-2.6.0.7z 를 받아 푸는데, 그 안에 macOS 용
# 심볼릭 링크(darwin/10.12/lib/*.dylib)가 들어 있다. Windows 에서 심링크를 만들려면
# 별도 권한(개발자 모드 또는 관리자)이 필요해서, 일반 사용자 계정에서는 압축 해제가
# 통째로 실패한다.
#
# Windows 빌드에 필요한 건 windows-10\ 아래 서명 도구뿐이고 darwin\ 은 쓰이지 않는다.
# 그래서 darwin 폴더를 제외하고 직접 풀어 캐시 자리에 놓는다.
# 이후 electron-builder 는 캐시가 있다고 보고 내려받기/압축 해제를 건너뛴다.
#
# 사용법:  powershell -ExecutionPolicy Bypass -File tools\prepare-wincodesign.ps1

$ErrorActionPreference = 'Stop'

$version = 'winCodeSign-2.6.0'
$url     = "https://github.com/electron-userland/electron-builder-binaries/releases/download/$version/$version.7z"
$cache   = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$dest    = Join-Path $cache $version
$archive = Join-Path $cache "$version.7z"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sevenZip    = Join-Path $projectRoot 'node_modules\7zip-bin\win\x64\7za.exe'

if (-not (Test-Path $sevenZip)) {
  throw "7za.exe 를 찾을 수 없습니다. 먼저 npm install 을 실행하세요: $sevenZip"
}

if (Test-Path (Join-Path $dest 'windows-10')) {
  Write-Host "이미 준비되어 있습니다: $dest" -ForegroundColor Green
  exit 0
}

New-Item -ItemType Directory -Force -Path $cache | Out-Null
Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue

Write-Host "내려받는 중: $url"
Invoke-WebRequest -Uri $url -OutFile $archive

Write-Host "푸는 중 (darwin 제외): $dest"
& $sevenZip x $archive "-o$dest" -y '-xr!darwin' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "압축 해제 실패 (exit $LASTEXITCODE)" }

Remove-Item $archive -Force -ErrorAction SilentlyContinue

if (-not (Test-Path (Join-Path $dest 'windows-10'))) {
  throw "windows-10 폴더가 없습니다. 압축 내용이 예상과 다릅니다."
}

Write-Host "완료. 이제 npm.cmd run build 를 실행하세요." -ForegroundColor Green
