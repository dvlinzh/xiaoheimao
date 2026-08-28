# 素材质检：扫描 assets/cat/*.png
#  · 连通域检测：身体不透明像素若存在 ≥2 个大连通块 → 疑似裁剪时混入相邻帧
#  · 底部空白：脚底到图片底边的透明行数（过大会导致角色悬空）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-assets.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Drawing.dll') -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AssetCheck {
  // 返回 (大连通块数, 底部空白行数)
  public static int[] Analyze(string path) {
    using (var bmp = new Bitmap(path)) {
      int w = bmp.Width, h = bmp.Height;
      var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var px = new byte[bd.Stride * h];
      Marshal.Copy(bd.Scan0, px, 0, px.Length);
      bmp.UnlockBits(bd);
      // 8 邻接 flood fill（迭代栈，防递归爆栈）
      var comp = new int[w * h];
      for (int i = 0; i < w * h; i++) comp[i] = px[i * 4 + 3] > 16 ? 0 : -1;
      int next = 0, maxBottom = 0;
      var areas = new List<int>();
      var stack = new Stack<int>();
      for (int i = 0; i < w * h; i++) {
        if (comp[i] != 0) continue;
        next++; int area = 0; stack.Push(i); comp[i] = next;
        while (stack.Count > 0) {
          int p = stack.Pop(); area++;
          int x = p % w, y = p / w;
          if (y > maxBottom) maxBottom = y;
          for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            int nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            int q = ny * w + nx;
            if (comp[q] == 0) { comp[q] = next; stack.Push(q); }
          }
        }
        areas.Add(area);
      }
      areas.Sort((a, b) => b.CompareTo(a));
      int major = 0;
      foreach (var a in areas) if (a > w * h * 0.01) major++;
      return new int[] { major, h - 1 - maxBottom };
    }
  }
}
"@

$dir = Join-Path (Split-Path -Parent $PSScriptRoot) "src\renderer\assets\cat"
$fail = 0
Get-ChildItem "$dir\*.png" | ForEach-Object {
  $r = [AssetCheck]::Analyze($_.FullName)
  $status = "OK"
  if ($r[0] -ge 2) { $status = "FAIL 疑似混入相邻帧($($r[0])个大块)"; $fail++ }
  elseif ($r[1] -gt 40) { $status = "WARN 底部空白 $($r[1])px（脚底悬空）" }
  $pad = $_.Name.PadRight(18)
  Write-Output "$pad major-components=$($r[0])  bottom-empty=$($r[1])px  $status"
}
if ($fail -gt 0) { Write-Output "`n质检不通过：$fail 张素材不合格"; exit 1 }
Write-Output "`n全部素材合格"
