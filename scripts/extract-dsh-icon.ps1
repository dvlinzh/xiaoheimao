# 提取 DeepSeek Harness 官方鲸鱼图标 → assets/icons/dsh.png
# 来源: 桌面 DeepSeek Harness\dsh-portable\launcher\ds-whale.ico
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\extract-dsh-icon.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "DeepSeek Harness\dsh-portable\launcher\ds-whale.ico"
if (-not (Test-Path $icoPath)) { throw "找不到鲸鱼图标: $icoPath" }

# 默认加载（取 ico 原生帧），再高质量缩放到 128
$icon = New-Object System.Drawing.Icon($icoPath)
$bmp = $icon.ToBitmap()
$out = New-Object System.Drawing.Bitmap(128, 128)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($bmp, 0, 0, 128, 128)
$dst = Join-Path $root "src\renderer\assets\icons\dsh.png"
$out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $out.Dispose(); $bmp.Dispose(); $icon.Dispose()
Write-Output "OK -> $dst"
