Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WEA {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  public struct RECT { public int L; public int T; public int R2; public int B2; }
}
"@
Add-Type -AssemblyName System.Drawing
$pet = (Get-Process PetCat -ErrorAction SilentlyContinue).Id
if (-not $pet) { Write-Output "PetCat not running"; exit }
$i = 0
$cb = [WEA+EnumProc]{ param($h, $l)
  $pid2 = 0
  [WEA]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  if ([int]$pid2 -eq [int]$pet) {
    $r = New-Object WEA+RECT
    [WEA]::GetWindowRect($h, [ref]$r) | Out-Null
    $w = $r.R2 - $r.L; $hh = $r.B2 - $r.T
    $vis = [WEA]::IsWindowVisible($h)
    Write-Output ("win$i hwnd=$h rect=($($r.L),$($r.T)) ${w}x${hh} vis=$vis")
    if ($w -gt 30 -and $hh -gt 30) {
      $i++
      $bmp = New-Object System.Drawing.Bitmap($w, $hh)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
      $bmp.Save("$env:USERPROFILE\Desktop\mind-board-pet\shell-win\pc-win-$i.png", [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose()
    }
  }
  return $true
}
[WEA]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
Write-Output done
