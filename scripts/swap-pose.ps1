# 姿态素材替换：裁透明边 → 等比缩放到目标高 → 水平居中写入 440x404 画布同尺度
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\swap-pose.ps1 -Src <路径> -Pose idle
param([string]$Src = "", [string]$Pose = "idle", [int]$TargetH = 400, [int]$MaxW = 438)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not $Src) { Write-Error "需要 -Src 素材路径"; exit 1 }
$root = Split-Path -Parent $PSScriptRoot
$dstFile = Join-Path $root "src\renderer\assets\cat\cat-$Pose.png"

$src = [System.Drawing.Bitmap]::FromFile($Src)
# 1. 不透明包围盒（alpha>8；全不透明图回退亮度>10）
$bd = $src.LockBits((New-Object System.Drawing.Rectangle(0, 0, $src.Width, $src.Height)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object "System.Byte[]" ($bd.Stride * $src.Height)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
$src.UnlockBits($bd)
$minX = $src.Width; $minY = $src.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $src.Height; $y++) {
  $row = $y * $bd.Stride
  for ($x = 0; $x -lt $src.Width; $x++) {
    $a = $bytes[$row + $x * 4 + 3]
    $lum = ([int]$bytes[$row + $x * 4] + [int]$bytes[$row + $x * 4 + 1] + [int]$bytes[$row + $x * 4 + 2])
    if ($a -gt 8 -or ($a -eq 255 -and $lum -gt 30)) {
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
$cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
# 2. 等比缩放到目标高（超宽则按宽约束）
$scale = [Math]::Min($TargetH / $ch, $MaxW / $cw)
$dw = [int]([Math]::Round($cw * $scale)); $dh = [int]([Math]::Round($ch * $scale))
# 3. 备份旧素材 → 裁剪+缩放写回
$bakDir = Join-Path $root "src\renderer\assets\cat.bak-20260829"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
Copy-Item $dstFile (Join-Path $bakDir "cat-$Pose.png") -Force
$out = New-Object System.Drawing.Bitmap $dw, $dh
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)), (New-Object System.Drawing.Rectangle($minX, $minY, $cw, $ch)), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose()
$out.Save($dstFile, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
Write-Output "$Pose : 源 $($src.Width)x$($src.Height) 内容(${cw}x${ch}) → ${dw}x${dh} (scale=$([Math]::Round($scale,3)))，旧图已备份 cat.bak-20260829/"
