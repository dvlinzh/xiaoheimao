# mind-board-pet — DSH 安装脚本（Cordis 插件壳，方式一）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-dsh.ps1
# 做三件事：① 检查与原 dsh-mind-board 插件冲突；② junction ×2 挂到 DSH profile；
#          ③ cordis.patch.yml 追加注册。完成后需【完全退出并重启 DSH】。
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot          # 仓库根
$profile = Join-Path $env:USERPROFILE ".dsh\profiles\web"

# ── 0) 冲突检查 ──
$patchFile = Join-Path $profile "cordis.patch.yml"
if (Test-Path $patchFile) {
  if (Select-String -Path $patchFile -Pattern "dsh-mind-board" -Quiet) {
    Write-Warning "检测到原有 dsh-mind-board 插件已注册——两者行为都是整理注入，双装会双份提醒。"
    Write-Host "  请先在 cordis.patch.yml 中移除 dsh-mind-board 的 insert，再执行本脚本。" -ForegroundColor Yellow
    Write-Host "  （或按 Ctrl+C 中止；继续安装请输入 y）"
    $ans = Read-Host "继续安装 mind-board-pet？[y/N]"
    if ($ans -notmatch "^[yY]") { Write-Host "已中止。"; exit 1 }
  }
}

# ── 1) junction ×2 ──
New-Item -ItemType Directory -Force -Path $profile | Out-Null
New-Item -ItemType Junction -Force -Path (Join-Path $profile "mind-board-pet") -Target $root | Out-Null
New-Item -ItemType Junction -Force -Path (Join-Path $profile "node_modules\mind-board-pet") -Target (Join-Path $profile "mind-board-pet") | Out-Null
Write-Host "  ✓ junctions 已建（源码改动即时生效，无需重装）" -ForegroundColor Green

# ── 2) cordis.patch.yml 注册 ──
$entry = @"
- insert:
    - id: mind-board-pet
      name: 'mind-board-pet'
"@
if (-not (Test-Path $patchFile)) {
  New-Item -ItemType Directory -Force -Path $profile | Out-Null
  Set-Content -Path $patchFile -Value "# mind-board-pet plugin entry`n$entry" -Encoding UTF8
  Write-Host "  ✓ cordis.patch.yml 已创建并注册" -ForegroundColor Green
} else {
  if (Select-String -Path $patchFile -Pattern "mind-board-pet" -Quiet) {
    Write-Host "  ✓ cordis.patch.yml 已含 mind-board-pet（跳过）" -ForegroundColor Green
  } else {
    Add-Content -Path $patchFile -Value $entry -Encoding UTF8
    Write-Host "  ✓ cordis.patch.yml 已追加注册" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "完成！最后一步（必须）：完全退出 DSH 进程并重启（host 启动时读取插件代码，刷新页面无效）。" -ForegroundColor Cyan
Write-Host "重启后：DSH 输入框右侧点【脑图标】开启整理模式；喊「喵喵喵」唤起桌面猫。" -ForegroundColor Cyan
