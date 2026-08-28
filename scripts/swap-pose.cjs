// 姿态素材替换：裁透明边 → 等比缩放到目标高 → 写入 assets/cat/
// 用法: npx electron scripts/swap-pose.mjs <素材路径> <pose> [目标高=400] [最大宽=438]
const { app, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

app.whenReady().then(() => {
  const [srcPath, pose, targetHS, maxWS] = process.argv.slice(2);
  if (!srcPath || !pose) { console.error("用法: electron swap-pose.mjs <素材路径> <pose> [目标高] [最大宽]"); app.exit(1); }
  const targetH = Number(targetHS || 400), maxW = Number(maxWS || 438);

  const img = nativeImage.createFromPath(srcPath);
  if (img.isEmpty()) { console.error("素材读取失败:", srcPath); app.exit(1); }
  const { width: W, height: H } = img.getSize();
  const buf = img.getBitmap();               // BGRA
  const stride = W * 4;

  // 不透明包围盒（alpha>8；全不透明回退亮度）
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * stride + x * 4;
      const a = buf[i + 3], lum = buf[i] + buf[i + 1] + buf[i + 2];
      if (a > 8 || (a === 255 && lum > 30)) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const scale = Math.min(targetH / ch, maxW / cw);
  const dw = Math.round(cw * scale), dh = Math.round(ch * scale);

  const dstFile = path.join(__dirname, "..", "src", "renderer", "assets", "cat", `cat-${pose}.png`);
  const bakDir = path.join(__dirname, "..", "src", "renderer", "assets", "cat.bak-20260829");
  fs.mkdirSync(bakDir, { recursive: true });
  fs.copyFileSync(dstFile, path.join(bakDir, `cat-${pose}.png`));

  const cropped = img.crop({ x: minX, y: minY, width: cw, height: ch });
  const scaled = cropped.resize({ width: dw, height: dh, quality: "best" });
  fs.writeFileSync(dstFile, scaled.toPNG());
  console.log(`${pose}: 源 ${W}x${H} 内容(${cw}x${ch}) → ${dw}x${dh} (scale=${scale.toFixed(3)})，旧图备份 cat.bak-20260829/`);
  app.exit(0);
});
