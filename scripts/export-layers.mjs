// CDP 导出尾巴图层组件拼图（调试可视化）
// 用法: 应用以 --remote-debugging-port=9222 启动后，node scripts/export-layers.mjs
const { writeFileSync } = await import("node:fs");
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tail-layers.png");
const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const t = list.find((x) => x.url.includes("pet.html"));
if (!t) { console.error("无 pet.html 调试目标"); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const call = (m, p = {}) => new Promise((res) => {
  const i = ++id;
  pend.set(i, res);
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
};
await new Promise((res) => { ws.onopen = res; });
await call("Runtime.enable");

const expr = `(async () => {
  const L = window.__mbLayers;
  if (!L) return "no layers";
  const W = 440, H = 404, GAP = 12;
  const out = document.createElement("canvas");
  out.width = W * 5 + GAP * 4; out.height = H;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#3a3a44"; ctx.fillRect(0, 0, out.width, out.height);
  const put = (x, c) => { ctx.drawImage(c, x, 0); };
  const imgC = document.createElement("canvas");
  imgC.width = W; imgC.height = H;
  const ic = imgC.getContext("2d");
  ic.drawImage(L.imgs.idle, Math.floor((W - L.imgs.idle.width) / 2), H - L.imgs.idle.height);
  put(0, imgC);
  put(W + GAP, L.tailData.idle.hard);
  put((W + GAP) * 2, L.tailData.idle.soft);
  put((W + GAP) * 3, L.workBody);
  put((W + GAP) * 4, L.workTail);
  return out.toDataURL("image/png");
})()`;
const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
if (r.exceptionDetails) { console.error("EXC:", r.exceptionDetails.exception?.description); process.exit(1); }
const dataUrl = r.result.value;
if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) { console.error("bad:", dataUrl); process.exit(1); }
writeFileSync(OUT, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("saved", OUT);
ws.close();
process.exit(0);
