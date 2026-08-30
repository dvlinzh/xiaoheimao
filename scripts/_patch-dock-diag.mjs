// 临时补丁：① pet.js 停止轮询期形状重建 ② dock.js 补输入诊断
import fs from "node:fs";

// ① pet.js
let p = fs.readFileSync("src/renderer/pet.js", "utf8");
const petOld = `    lastDataAt = Date.now();
    applyOverview(ov);
    // 蒙版/形状周期重建：素材替换或姿态切换若未触发 setMood/setDrag，
    // 旧的 alphaMap/setShape 会把新画面裁掉（"每个状态都被截"的根因）。
    // 2.5s 一次的全量重建成本 ~几毫秒，换来自动对齐。
    if (Pet) buildAlphaMap();`;
const petNew = `    lastDataAt = Date.now();
    applyOverview(ov);
    // 不要在这里周期性 buildAlphaMap()：每次重建都会重设 petWin.setShape，
    // SetWindowRgn 在光标下方反复触发窗口区域重算，搅乱点击命中。
    // 形状对齐由 adoptSkin / setMood / setDrag 的 rAF 回调保证。`;
if (p.includes(petOld)) { p = p.replace(petOld, petNew); console.log("pet.js: poll rebuild removed"); }
else console.log("pet.js: poll rebuild block not found (skip)");
fs.writeFileSync("src/renderer/pet.js", p);

// ② dock.js
let d = fs.readFileSync("src/renderer/dock.js", "utf8");
if (!d.includes("[dock] beat")) {
  const anchor = "/* tooltip：JS 定位 + 窗口内收拢，不会再被裁 */";
  const diag = `/* 心跳探针：输入事件计数 + 光标位置 5s 上报（electron.log） */
window.__dockEvts = { move: 0, down: 0, up: 0 };
document.addEventListener("mousemove", () => window.__dockEvts.move++, true);
document.addEventListener("mousedown", () => window.__dockEvts.down++, true);
document.addEventListener("mouseup", () => window.__dockEvts.up++, true);
let lastCursor = null;
setInterval(() => {
  console.log("[dock] beat evts:", JSON.stringify(window.__dockEvts),
    "cursor:", lastCursor ? JSON.stringify(lastCursor) : "none");
}, 5000);

`;
  d = d.replace(anchor, diag + anchor);
  const visOld = `document.addEventListener("visibilitychange", () => {`;
  const visNew = `document.addEventListener("mousemove", (e) => {
  lastCursor = { x: e.clientX, y: e.clientY, over: overChip(e.clientX, e.clientY) };
});
function overChip(x, y) {
  for (const el of dock.querySelectorAll(".chip")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}
document.addEventListener("visibilitychange", () => {`;
  d = d.replace(visOld, visNew);
  console.log("dock.js: diagnostics added");
} else console.log("dock.js: diagnostics already present");
fs.writeFileSync("src/renderer/dock.js", d);
