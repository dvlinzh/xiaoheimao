// CDP 渲染层探针 —— 诊断桌宠交互链路
// 用法: 先以 --remote-debugging-port=9222 启动应用，再 node scripts/cdp-probe.mjs
// 检查: petBridge/pet 皮肤/画布/可点击状态/元素命中，并模拟一次 setClickable
import { setTimeout as sleep } from "node:timers/promises";

const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const target = list.find((t) => t.url.includes("pet.html"));
if (!target) { console.error("未找到 pet.html 调试目标:", list.map((t) => t.url)); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise((res) => {
  const mid = ++id;
  pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
};
await new Promise((res) => { ws.onopen = res; });
await call("Runtime.enable");

async function evaluate(expression) {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { EXCEPTION: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result.value;
}

const report = await evaluate(`JSON.stringify({
  bridge: typeof window.petBridge,
  petSkin: typeof window.PetSkinCat,
  pet: window.Pet ? { hasEl: !!window.Pet.el, tag: window.Pet.el?.tagName } : null,
  canvas: (() => { const c = document.getElementById("pet-canvas"); return c ? { w: c.width, h: c.height, cssW: c.style.width, rect: c.getBoundingClientRect().toJSON() } : null; })(),
  zone: (() => { const z = document.getElementById("rabbit-zone"); return z ? z.getBoundingClientRect().toJSON() : null; })(),
  hitCenter: (() => { const c = document.getElementById("pet-canvas"); if (!c) return null; const r = c.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el ? el.id || el.tagName : null; })(),
  inBrowser: document.documentElement.className,
})`);
console.log("== 渲染层现场 ==");
console.log(typeof report === "string" ? JSON.stringify(JSON.parse(report), null, 2) : report);

console.log("== 强制 setClickable(true) ==");
console.log(await evaluate(`window.petBridge ? (window.petBridge.setClickable(true), "called") : "no bridge"`));

await sleep(300);
ws.close();
process.exit(0);
