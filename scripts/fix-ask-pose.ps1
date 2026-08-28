# 修复 cat-ask.png：从备份恢复干净帧并水平镜像（朝向与其他姿势统一为朝左）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fix-ask-pose.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "src\renderer\assets\cat.bak-20260828\cat-ask.png"
$dst = Join-Path $root "src\renderer\assets\cat\cat-ask.png"

$img = [System.Drawing.Bitmap]::FromFile($src)
$img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX)
$img.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
Write-Output "OK ask restored + mirrored -> $dst"
