# 思维板·小黑猫 — 一键安装（PowerShell 主脚本，由 install.bat 调用）
# 需要 Node.js >= 18；Electron 走 npmmirror 镜像加速（国内必用，全球可达）
# 用法: 双击 install.bat；脚本完成依赖安装并启动应用
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
chcp 65001 | Out-Null
$Host.UI.RawUI.WindowTitle = "mind-board-pet install"

Write-Host ""
Write-Host "  [1/3] 检查 Node.js ..." -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  ✗ 未找到 Node.js。请先安装：https://nodejs.org （LTS 版即可）" -ForegroundColor Red
  exit 1
}
$ver = & node -v
Write-Host "  ✓ Node.js $ver" -ForegroundColor Green

Write-Host ""
Write-Host "  [2/3] 安装依赖（Electron 走国内镜像加速，首次约 1-3 分钟）..." -ForegroundColor Cyan
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
& npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) {
  Write-Host "  ✗ 依赖安装失败。可重试：npm install" -ForegroundColor Red
  exit 1
}
Write-Host "  ✓ 依赖就绪" -ForegroundColor Green

Write-Host ""
Write-Host "  [3/3] 启动小黑猫 ..." -ForegroundColor Cyan
& npm start
exit $LASTEXITCODE
