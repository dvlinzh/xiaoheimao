// 尾巴组件重新裁剪 —— 把 poly（软蒙版）与 bodyPoly（洞）的前端截到「球后」
// 用户校准值见 CUTS（球左缘：idle=364, walk=317, run=308, crouch=288）。
// 起点=球后 → 尾巴层只含「球+大尾巴」，球前根段留在身体层（随身体呼吸，不随尾巴摆）。
// 裁完重启后 mount 会自动按「洞左缘质心」重算呼吸轴心=球后接缝。
// 用法: node scripts/cut-tail.mjs
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const PATH = "src/renderer/assets/cat/cat-tails.json";
const j = JSON.parse(readFileSync(PATH, "utf8"));
copyFileSync(PATH, "src/renderer/assets/cat/cat-tails.bak.json");
console.log("已备份 -> cat-tails.bak.json");

const CUTS = {
  "cat-idle":   { body: 323, poly: 317 },   // 球右缘（素材放大核验：球 x290-322）
  "cat-walk":   { body: 325, poly: 319 },
  "cat-run":    { body: 210, poly: 204 },   // 球 x183-210（3x 放大核验）
  "cat-crouch": { body: 222, poly: 216 },   // 球 x195-222（3x 放大核验）
};

// Sutherland–Hodgman：保留 x>=cut 半边，缺口用竖边闭合（凹多边形同样正确）
function clip(poly, cut) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const aIn = a[0] >= cut, bIn = b[0] >= cut;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (cut - a[0]) / (b[0] - a[0]);
      out.push([Math.round(cut), Math.round(a[1] + t * (b[1] - a[1]))]);
    }
  }
  return out;
}

for (const [pose, { body, poly }] of Object.entries(CUTS)) {
  const def = j[pose];
  if (!def) { console.error("姿势缺失:", pose); process.exit(1); }
  def.bodyPoly = clip(def.bodyPoly, body);
  def.poly = clip(def.poly, poly);
  console.log(`${pose}: bodyPoly ${def.bodyPoly.length} 顶点, poly ${def.poly.length} 顶点`);
}

writeFileSync(PATH, JSON.stringify(j, null, 2));
console.log("已重写 cat-tails.json");
