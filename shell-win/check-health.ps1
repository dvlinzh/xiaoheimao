# 思维板·小黑猫 — 一键体检
# 用法: 双击 shell-win\体检.bat（或 powershell -File check-health.ps1）
# 输出: shell-win\health-report.txt（把整个文件发给开发即可）
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "health-report.txt"
$log = @()

function Say($t) { Write-Host $t; $script:log += $t }

Say "════ 思维板 · 小黑猫 体检报告 ════"
Say ("时间: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))

# 1. 进程
Say ""
Say "── 进程 ──"
$petcat = Get-Process PetCat -ErrorAction SilentlyContinue
$elec = Get-Process electron -ErrorAction SilentlyContinue
$node = Get-Process node -ErrorAction SilentlyContinue
if ($petcat) { Say ("✓ PetCat 运行中 pid=" + ($petcat.Id -join ",")) } else { Say "✗ PetCat 未运行（猫本体没了）" }
if ($node) { Say ("✓ node 运行中（数据服务可能由它提供）") } else { Say "－ node 未运行" }
if ($elec) { Say ("⚠ Electron 仍在运行（已退役的旧壳，建议结束进程）pid=" + ($elec.Id -join ",")) } else { Say "✓ 无 Electron 残留" }

# 2. 数据服务
Say ""
Say "── 数据服务 13134 ──"
try {
  $ov = Invoke-RestMethod "http://127.0.0.1:13134/api/overview" -TimeoutSec 3
  Say "✓ 服务正常"
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  foreach ($p in $ov.projects) {
    foreach ($h in $p.harnesses) {
      $la = 0; if ($p.liveAtMs) { $la = [long]$p.liveAtMs }
      $ageMin = [Math]::Round(($now - $la) / 60000, 0)
      Say ("  harness: $h ｜ 项目: $($p.title) ｜ 最后写盘: $ageMin 分钟前" + $(if ($ageMin -lt 30) { " 〈环上应有此芯片〉" }))
    }
  }
  $mode = $ov.settings.mode
  Say ("  整理模式: $mode")
} catch { Say "✗ 数据服务无响应：$($_.Exception.Message)" }

# 3. PetCat 窗口
Say ""
Say "── PetCat 窗口（位置/尺寸/可见性）──"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WH {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  public struct RECT { public int L; public int T; public int R2; public int B2; }
}
"@
if ($petcat) {
  $pid2 = $petcat.Id
  $cb = [WH+EnumProc]{ param($h, $l)
    $pid3 = 0
    [WH]::GetWindowThreadProcessId($h, [ref]$pid3) | Out-Null
    if ([int]$pid3 -eq [int]$pid2) {
      $r = New-Object WH+RECT
      [WH]::GetWindowRect($h, [ref]$r) | Out-Null
      $w = $r.R2 - $r.L; $hh = $r.B2 - $r.T
      $vis = [WH]::IsWindowVisible($h)
      if ($w -gt 30 -and $hh -gt 30) {
        Say ("  窗口: ($($r.L),$($r.T)) ${w}x${hh} 可见=$vis")
        $bmp = New-Object System.Drawing.Bitmap($w, $hh)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
        $bmp.Save((Join-Path $PSScriptRoot ("health-win-" + $pid3 + "-" + [int]$r.L + ".png")), [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
        Say "    （已截图 health-win-*.png）"
      }
    }
    return $true
  }
  [WH]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
} else { Say "（PetCat 未运行，跳过）" }

# 4. 结论提示
Say ""
Say "── 判读 ──"
Say "· PetCat 未运行 → 双击 shell-win\PetCat.exe"
Say "· 窗口列表里没有 280×260 的环窗 → 环未弹出：单击猫一次"
Say "· 环窗存在但截图里没有芯片 → 数据/渲染断层，把本文件发给开发"
$log | Set-Content $out -Encoding UTF8
Write-Host ""
Write-Host "体检完成 → $out" -ForegroundColor Green
