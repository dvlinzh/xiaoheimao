# 给素材左侧加透明留白（防精灵图裁剪贴边被缩放吃掉）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pad-asset.ps1 [-Name sleep] [-Pad 4]
param([string]$Name = "sleep", [int]$Pad = 4)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root "src\renderer\assets\cat\cat-$Name.png"
$src = [System.Drawing.Bitmap]::FromFile($file)
$w = $src.Width; $h = $src.Height
$dst = New-Object System.Drawing.Bitmap ($w + $Pad), $h
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($src, $Pad, 0, $w, $h)
$g.Dispose(); $src.Dispose()
$dst.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()
Write-Output "$Name : $($w)x$($h) -> $($w+$Pad)x$($h) (left +$Pad px)"
