// CDP 悬停转发测试 —— 注入事件计数器，真实移动光标到猫身上，读回计数
// 用法: 应用以 --remote-debugging-port=9222 启动后，node scripts/cdp-input-test.mjs
// 退出码: 0=转发正常  2=转发失效
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const t = list.find((x) => x.url.includes("pet.html"));
if (!t) { console.error("INPUT-TEST: 未找到 pet.html 调试目标"); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const call = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise((res) => { ws.onopen = res; });
await call("Runtime.enable");
const ev = async (expr) => (await call("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.value;

const geo = JSON.parse(await ev(`JSON.stringify({ x: window.screenX, y: window.screenY, w: innerWidth, h: innerHeight })`));
const cx = geo.x + Math.round(geo.w / 2), cy = geo.y + Math.round(geo.h * 0.68);   // 猫身中心

await ev(`(() => { window.__t = { move: 0, down: 0 }; document.addEventListener("mousemove", () => window.__t.move++, true); document.addEventListener("mousedown", () => window.__t.down++, true); return 1; })()`);
execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(1000,500); Start-Sleep -Milliseconds 250; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx},${cy})"`);
await sleep(900);
const r = JSON.parse(await ev(`JSON.stringify(window.__t)`));
console.log(`INPUT-TEST: 目标=(${cx},${cy}) move=${r.move} down=${r.down} → ${r.move > 0 ? "转发正常" : "转发失效"}`);
ws.close();
process.exit(r.move > 0 ? 0 : 2);
