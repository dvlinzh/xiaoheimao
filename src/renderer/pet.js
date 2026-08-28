// pet.js — 宠物窗行为：皮肤适配 / 表情状态机 / 拖拽 / 开场白 / 窗口联动
const $ = (s) => document.querySelector(s);

const bridge = window.petBridge || null;
if (!bridge) document.documentElement.classList.add("in-browser");

/* ── 状态 ── */
let mode = "off";
let lastDataAt = Date.now();
let lastInteraction = Date.now();
let alertUntil = 0;
let celebrateUntil = 0;
let prevGapMap = {};
let prevTotalGaps = null;
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

  const act = (ov.projects || []).filter((p) => p.active !== false);

  let totalGaps = 0;
  for (const p of act) totalGaps += p.counts.gaps;
  for (const p of act) {
    const before = prevGapMap[p.id];
    if (before !== undefined && p.counts.gaps > before) alertUntil = Date.now() + 20000;
    prevGapMap[p.id] = p.counts.gaps;
  }
  if (prevTotalGaps !== null && prevTotalGaps > 0 && totalGaps === 0 && modules.celebrate) {
    celebrateUntil = Date.now() + 2400;
  }
  prevTotalGaps = totalGaps;

  const anyAsk = act.some((p) => p.pendingNewTask);

  let mood = "idle";
  if (anyAsk) mood = "ask";
  else if (Date.now() < celebrateUntil) mood = "celebrate";
  else if (Date.now() < alertUntil) mood = "alert";
  else if (mode !== "on") mood = "sleep";
  else if (Date.now() - Math.max(lastDataAt, lastInteraction) > 10 * 60 * 1000) mood = "sleep";
  Pet?.setMood(mood);
  if (mood === "celebrate") Pet?.hop();
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

/* ── 拖拽 + 单击切图标条 + 双击颠球 ── */
let pressInfo = null;
let clickTimer = null;
zone.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
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
zone.addEventListener("dblclick", () => {
  clearTimeout(clickTimer);
  if (modules.juggle) Pet?.juggle();
});

/* 右键 → 设置窗 */
zone.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  bridge?.toggleSettings();
});

/* ── 逐像素命中 + 动态穿透 ──
   窗口默认点击穿透（main 启动时 ignoreMouseEvents(true,{forward:true})），
   悬停到角色不透明像素才切可点击——拼豆间隙照常透传，不挡底下界面。 */
let clickable = false;
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

function overPet(x, y) {
  const sp = $("#speech");
  if (sp && !sp.hidden) {
    const r = sp.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
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

function setClickable(c) {
  if (pressInfo) return;        // 拖拽中锁定可点，防中途穿透丢 mouseup
  if (c === clickable) return;
  clickable = c;
  bridge?.setClickable(c);
}

/* ── 鼠标活动 ── */
document.addEventListener("mousemove", (e) => {
  lastInteraction = Date.now();
  setClickable(overPet(e.clientX, e.clientY));
});
document.addEventListener("mouseout", (e) => { if (!e.relatedTarget) setClickable(false); });

/* 拖拽姿态：主进程判定真实拖动后推送（被拎走的猫） */
bridge?.onDrag?.((v) => Pet?.setDrag?.(v));

/* ── 启动 ── */
poll();
setInterval(poll, 2500);
