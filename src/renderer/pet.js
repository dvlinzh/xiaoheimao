// pet.js — 宠物窗行为：皮肤适配 / 表情状态机 / 拖拽 / 开场白 / 窗口联动
const $ = (s) => document.querySelector(s);

const bridge = window.petBridge || null;
if (!bridge) document.documentElement.classList.add("in-browser");

/* ── 状态 ── */
let mode = "off";
let lastDataAt = Date.now();
let lastInteraction = Date.now();
let modules = { juggle: true, autoJuggle: true, speech: true, tutorial: true, celebrate: true };
let Pet = null;            // 当前皮肤 API
let greeted = false;

const stage = $("#stage");
const zone = $("#rabbit-zone");

/* 诊断计数器：观察 OS 层鼠标事件是否真的投递进渲染层（CDP 读 window.__mbEvts） */
window.__mbEvts = { move: 0, down: 0, up: 0 };
document.addEventListener("mousemove", () => window.__mbEvts.move++, true);
document.addEventListener("mousedown", () => window.__mbEvts.down++, true);
document.addEventListener("mouseup", () => window.__mbEvts.up++, true);
/* 心跳探针：每 5s 经 [pet:console] 上报事件计数与穿透状态——
   electron.log 里对比两次心跳的增量即可判断交互断在 OS 投递层还是渲染逻辑层 */
setInterval(() => {
  // 采样猫身中心点的 alpha：alphaMap 与画面错位/过期时这里会是 0
  let ac = -1;
  try {
    const cvs = Pet?.el;
    if (cvs && alphaMap && cvs.width) {
      const r = cvs.getBoundingClientRect();
      const px = Math.floor((95 - r.left) / r.width * cvs.width);
      const py = Math.floor((110 - r.top) / r.height * cvs.height);
      ac = (px >= 0 && py >= 0 && px < cvs.width && py < cvs.height) ? alphaMap[py * cvs.width + px] : -2;
    }
  } catch {}
  console.log("[pet] beat evts:", JSON.stringify(window.__mbEvts),
    "press:", pressInfo ? "locked" : "none",
    "alpha:", alphaMap ? "ok" : "null", "alphaC:", ac, "chipRects:", chipRects.length);
}, 5000);

/* ── 皮肤装载 ── */
let curSkin = "";
async function adoptSkin(name) {
  curSkin = name;
  if (Pet) { Pet.el.remove(); Pet = null; }
  Pet = await window.PetSkinCat.mount($("#pet-host"), () => requestAnimationFrame(buildAlphaMap));
  // 表情/拖拽切换姿态后重算逐像素命中表
  for (const k of ["setMood", "setDrag"]) {
    const raw = Pet[k].bind(Pet);
    Pet[k] = (v) => { raw(v); requestAnimationFrame(buildAlphaMap); };
  }
  window.Pet = Pet;
  buildAlphaMap();
}

/* ── 轮询 ── */
async function poll() {
  if (pressInfo && Date.now() - pressInfo.t > 5000) pressInfo = null;   // 丢 mouseup 兜底
  try {
    const r = await fetch("/api/overview");
    const ov = await r.json();
    lastDataAt = Date.now();
    applyOverview(ov);
  } catch {}
}

function applyOverview(ov) {
  mode = ov.settings?.mode || "off";
  modules = ov.settings?.modules || modules;

  const wantSkin = ov.settings?.skin || "cat";
  if (wantSkin !== curSkin && window.PetSkinCat) {
    adoptSkin(wantSkin);
  }

  // 首次数据 → 开场白
  if (!greeted) {
    greeted = true;
    if (modules.speech) speak((ov.settings?.greetings || ["就位。"])[Math.floor(Math.random() * (ov.settings?.greetings || ["就位。" ]).length)]);
  }

  // 状态只剩两种：整理中 idle / 关闭整理 sleep（alert/ask/celebrate 已按需求移除）
  Pet?.setMood(mode !== "on" ? "sleep" : "idle");
}

/* ── 开场白 ── */
let speechTimer = null;
function speak(text) {
  const el = $("#speech");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

/* ── 拖拽 + 单击切图标条 + 双击颠球 ──
   交互态由主进程轮询驱动（光标进窗=整窗可点），这里只按像素判定
   「点没点在猫身上」：透明像素的点击吸收不动（代价：悬停猫窗时其
   矩形范围内的下层应用收不到点击——桌面宠的标准取舍）。 */
let pressInfo = null;
let clickTimer = null;
zone.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!overPet(e.clientX, e.clientY)) return;   // 透明像素：吸收，不触发拖拽/单击
  pressInfo = { x: e.clientX, y: e.clientY, t: Date.now() };
  bridge?.dragStart();
});
document.addEventListener("mouseup", (e) => {
  bridge?.dragEnd();
  if (!pressInfo) return;
  const moved = Math.hypot(e.clientX - pressInfo.x, e.clientY - pressInfo.y);
  const dt = Date.now() - pressInfo.t;
  pressInfo = null;
  if (moved < 6 && dt < 450) {
    // 单击：切换图标条；若 280ms 内来了第二击 → 双击，转为颠球
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => bridge?.toggleDock(), 280);
  }
});
zone.addEventListener("dblclick", (e) => {
  if (!overPet(e.clientX, e.clientY)) return;
  clearTimeout(clickTimer);
  if (modules.juggle) Pet?.juggle();
});

/* 右键 → 设置窗 */
zone.addEventListener("contextmenu", (e) => {
  if (!overPet(e.clientX, e.clientY)) return;
  e.preventDefault();
  bridge?.toggleSettings();
});

/* ── 逐像素命中 + 动态穿透 ──
   窗口默认点击穿透（main 启动时 ignoreMouseEvents(true,{forward:true})），
   悬停到角色不透明像素才切可点击——拼豆间隙照常透传，不挡底下界面。 */

let alphaMap = null;

function buildAlphaMap() {
  alphaMap = null;
  const cvs = Pet?.el;
  if (!cvs || cvs.tagName !== "CANVAS") return;
  try {
    const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
    const m = new Uint8Array(cvs.width * cvs.height);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
    alphaMap = m;
  } catch {}
}

/* 芯片命中排除：dock 可见时，其芯片屏幕矩形由主进程推送过来。
   光标落在这些矩形内时猫一律不命中——点击芯片永远不会被猫窗截胡。 */
let chipRects = [];
bridge?.onChipRects?.((r) => { chipRects = Array.isArray(r) ? r : []; });

function overPet(x, y) {
  const sp = $("#speech");
  if (sp && !sp.hidden) {
    const r = sp.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  // 屏幕坐标 = 窗口原点 + 客户区坐标（缩放 1:1）
  const sx = (window.screenX || 0) + x, sy = (window.screenY || 0) + y;
  for (const r of chipRects) {
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return false;
  }
  const cvs = Pet?.el;
  if (!cvs) return false;
  const r = cvs.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
  if (!alphaMap) return true;   // SVG 皮肤：包围盒命中
  const px = Math.floor((x - r.left) / r.width * cvs.width);
  const py = Math.floor((y - r.top) / r.height * cvs.height);
  return alphaMap[py * cvs.width + px] > 8;
}

/* 交互态双通道驱动：渲染层 mousemove（事件正常时）+ 主进程光标轮询
   （钩子被摘时）都会调用 setClickable，由 overPet 做逐像素判定。 */
document.addEventListener("mousemove", (e) => {
  lastInteraction = Date.now();
  setClickable(overPet(e.clientX, e.clientY));
});

/* 拖拽姿态：主进程判定真实拖动后推送（被拎走的猫） */
bridge?.onDrag?.((v) => Pet?.setDrag?.(v));
bridge?.onDragPhys?.((v) => Pet?.setSwing?.(v.vx));   // 拖拽速度 → 拎起摆动激励

/* ── 启动 ── */
poll();
setInterval(poll, 2500);
