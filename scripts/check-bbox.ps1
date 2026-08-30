# Asset bbox vs window geometry check (ASCII output to avoid PS5 encoding issues)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "src\renderer\assets\cat"
foreach ($f in @("cat-idle.png", "cat-sleep.png", "cat-walk.png")) {
  $b = New-Object System.Drawing.Bitmap (Join-Path $dir $f)
  $minX = 99999; $maxX = -1; $minY = 99999; $maxY = -1
  for ($y = 0; $y -lt $b.Height; $y += 2) {
    for ($x = 0; $x -lt $b.Width; $x += 2) {
      if ($b.GetPixel($x, $y).A -gt 100) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $ox = [Math]::Floor((520 - $b.Width) / 2)
  $dispL = 31 + $ox * 0.42                     # canvas left edge inside window = 31
  $dispR = $dispL + $maxX * 0.42
  $dispL2 = $dispL + $minX * 0.42
  Write-Output ($f + "  img=" + $b.Width + "x" + $b.Height + "  contentX=[" + $minX + ".." + $maxX + "] contentY=[" + $minY + ".." + $maxY + "]  windowX=[" + [Math]::Round($dispL2, 1) + ".." + [Math]::Round($dispR, 1) + "]")
  $b.Dispose()
}
Write-Output "--- window 280x250; canvas left = 31; canvas display width = 218"
