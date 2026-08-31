# 思维板·小黑猫 启动器（C# 原生壳版）
# 流程：检查 Node → 缺依赖则安装 → 缺 PetCat.exe 则构建 → 启动（数据服务由 PetCat 兜底拉起）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
chcp 65001 | Out-Null
$Host.UI.RawUI.WindowTitle = "mind-board-pet"

Write-Host ""
Write-Host "  [1/4] 检查 Node.js ..." -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  ✗ 未找到 Node.js。请先安装：https://nodejs.org （LTS 版即可）" -ForegroundColor Red
  exit 1
}
Write-Host "  ✓ Node.js $(& node -v)" -ForegroundColor Green

Write-Host ""
Write-Host "  [2/4] 依赖检查 ..." -ForegroundColor Cyan
if (-not (Test-Path "node_modules")) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  & npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Write-Host "  ✗ npm install 失败" -ForegroundColor Red; exit 1 }
  Write-Host "  ✓ 依赖已安装" -ForegroundColor Green
} else {
  Write-Host "  ✓ 依赖已就绪" -ForegroundColor Green
}

Write-Host ""
Write-Host "  [3/4] 原生壳检查 ..." -ForegroundColor Cyan
if (-not (Test-Path "shell-win\PetCat.exe")) {
  Write-Host "  未构建 PetCat.exe，开始构建（首次约 1 分钟）..." -ForegroundColor Cyan
  & cmd /c "shell-win\fetch-deps.bat"
  & cmd /c "shell-win\build.bat"
  if (-not (Test-Path "shell-win\PetCat.exe")) {
    Write-Host "  ✗ 构建失败：shell-win\build.bat" -ForegroundColor Red
    exit 1
  }
}
Write-Host "  ✓ PetCat.exe 就绪" -ForegroundColor Green

Write-Host ""
Write-Host "  [4/4] 启动小黑猫 ..." -ForegroundColor Cyan
& npm start
