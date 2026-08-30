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
    "alpha:", alphaMap ? "ok" : "null", "alphaC:", ac, "chipRects:", chipRects.length,
    "lastMove:", JSON.stringify(lastMove));
}, 5000);

/* ── 皮肤装载 ── */
let curSkin = "";
let shapeRebuildTimer = null;
function scheduleShapeRebuild(delay) {
  clearTimeout(shapeRebuildTimer);
  shapeRebuildTimer = setTimeout(() => buildAlphaMap(), delay);
}
async function adoptSkin(name) {
  curSkin = name;
  if (Pet) { Pet.el.remove(); Pet = null; }
  Pet = await window.PetSkinCat.mount($("#pet-host"), () => requestAnimationFrame(buildAlphaMap));
  // 表情/姿态切换后重算逐像素命中表（rAF 顺序：渲染循环先画、这里后采样）
  // 表情/姿态切换后重算逐像素命中表（rAF 顺序：渲染循环先画、这里后采样）。
  // 姿态未变时跳过——applyOverview 每 2.5s 都会调 setMood，无条件重建会让
  // petWin.setShape 被高频重设，搅乱光标下的点击命中（点芯片失灵的元凶）。
  let lastMood = null;
  for (const k of ["setMood"]) {
    const raw = Pet[k].bind(Pet);
    Pet[k] = (v) => {
      if (v === lastMood) return;
      lastMood = v;
      raw(v);
      requestAnimationFrame(buildAlphaMap);
    };
  }
  // 拖拽释放：摆动衰减的旋转像素会超出静态形状——立即清空剪裁（矩形暂代），
  // 约 1.1s 摆动落定后重建。拖拽期间主进程本就清空了形状。
  if (Pet.setDrag) {
    const rawDrag = Pet.setDrag.bind(Pet);
    Pet.setDrag = (v) => {
      rawDrag(v);
      if (!v) suppressShape(1100);
    };
  }
  // hop/juggle：CSS 把画布上移 20px，会跳出静态剪裁区——起跳清空，落定重建
  if (Pet.hop) {
    const rawHop = Pet.hop.bind(Pet);
    Pet.hop = (...a) => {
      suppressShape(2100);
      rawHop(...a);
    };
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
    // 不要在这里周期性 buildAlphaMap()：每次重建都会重设 petWin.setShape，
    // SetWindowRgn 在光标下方反复触发窗口区域重算，搅乱点击命中。
    // 形状对齐由 adoptSkin / setMood / setDrag 的 rAF 回调保证。
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
  if (!nearPet(e.clientX, e.clientY)) return;   // 宽松命中：透明且远离猫身才吸收   // 透明像素：吸收，不触发拖拽/单击
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
  if (!nearPet(e.clientX, e.clientY)) return;   // 宽松命中：透明且远离猫身才吸收
  clearTimeout(clickTimer);
  if (modules.juggle) Pet?.juggle();
});

/* 右键 → 设置窗 */
zone.addEventListener("contextmenu", (e) => {
  if (!nearPet(e.clientX, e.clientY)) return;   // 宽松命中：透明且远离猫身才吸收
  e.preventDefault();
  bridge?.toggleSettings();
});

/* ── 逐像素命中 + 动态穿透 ──
   窗口默认点击穿透（main 启动时 ignoreMouseEvents(true,{forward:true})），
   悬停到角色不透明像素才切可点击——拼豆间隙照常透传，不挡底下界面。 */

let alphaMap = null;        // 严格命中：像素不透明才算
let alphaWide = null;       // 宽松命中：整猫外扩 ~5 屏幕px（耳尖/尾巴/耳间空隙都算猫）
let alphaWideW = 0, alphaWideH = 0, alphaPad = 0;
let petShape = [];
let shapeSuppressed = 0;    // >0 = 动画进行中，buildAlphaMap 不上报形状（跳姿/摆动的像素会超出静态形状）
function suppressShape(ms) {
  shapeSuppressed++;
  window.petBridge?.sendPetShape?.([]);   // 立即清空剪裁（越界动作不受裁）
  clearTimeout(shapeRebuildTimer);
  shapeRebuildTimer = setTimeout(() => { shapeSuppressed = 0; buildAlphaMap(); }, ms);
}

function buildAlphaMap() {
  alphaMap = null; alphaWide = null; petShape = [];
  const cvs = Pet?.el;
  if (!cvs || cvs.tagName !== "CANVAS") return;
  try {
    const d = cvs.getContext("2d").getImageData(0, 0, cvs.width, cvs.height).data;
    const m = new Uint8Array(cvs.width * cvs.height);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
    alphaMap = m;
    // 宽松版：素材向 8 方向各偏移 pad 后取并集（形态学膨胀），耳尖细部不再漏点
    const pad = 12;   // canvas px ≈ 5 屏幕px（×0.42）：贴边可点但不吞远处点击
    const rc = cvs.getBoundingClientRect();   // 画布在窗口内的位置/尺寸（setShape 用窗口坐标）
    const wc = document.createElement("canvas");
    wc.width = cvs.width + pad * 2; wc.height = cvs.height + pad * 2;
    const wctx = wc.getContext("2d", { willReadFrequently: true });
    for (const [dx, dy] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad], [pad, pad], [-pad, pad], [pad, -pad], [-pad, -pad]])
      wctx.drawImage(cvs, pad + dx, pad + dy);
    const wd = wctx.getImageData(0, 0, wc.width, wc.height).data;
    alphaWide = new Uint8Array(wc.width * wc.height);
    for (let i = 0; i < alphaWide.length; i++) alphaWide[i] = wd[i * 4 + 3];
    alphaWideW = wc.width; alphaWideH = wc.height; alphaPad = pad;
    /* 形状矩形：膨胀命中区栅格化（8px 格，格内任一像素 alpha>100 即实心），
     * 按行合并 → win.setShape。OS 在形状外原生点击穿透——
     * 无轮询竞态、无首点吞噬，透明区点击直达下层应用。 */
    const CELL = 8, scale = 0.42;
    const cols = Math.ceil(wc.width / CELL), rows = Math.ceil(wc.height / CELL);
    for (let ry = 0; ry < rows; ry++) {
      let run = -1;
      for (let rx = 0; rx <= cols; rx++) {
        let filled = false;
        if (rx < cols) {
          outer: for (let y = ry * CELL; y < Math.min((ry + 1) * CELL, wc.height); y += 2)
            for (let x = rx * CELL; x < Math.min((rx + 1) * CELL, wc.width); x += 2)
              if (wd[(y * wc.width + x) * 4 + 3] > 100) { filled = true; break outer; }
        }
        if (filled && run < 0) run = rx;
        if (run >= 0 && (!filled || rx === cols)) {
          const sx = rc.width / cvs.width, sy = rc.height / cvs.height;   // canvas px → 窗口 px
          petShape.push({
            x: Math.round(rc.left + (run * CELL - pad) * sx) - 1,
            y: Math.round(rc.top + (ry * CELL - pad) * sy) - 1,
            width: Math.ceil((rx - run) * CELL * sx) + 2,
            height: Math.ceil(CELL * sy) + 2,
          });
          run = -1;
        }
      }
    }
    if (petShape.length) {
      const xs = petShape.map((r) => r.x), xe = petShape.map((r) => r.x + r.width);
      const ys = petShape.map((r) => r.y), ye = petShape.map((r) => r.y + r.height);
      console.log("[pet] shape rects:", petShape.length,
        "bbox x[" + Math.min(...xs) + ".." + Math.max(...xe) + "] y[" + Math.min(...ys) + ".." + Math.max(...ye) + "]");
    }
    if (pressInfo) return;           // 拖拽中不上报（主进程已清空形状）
    if (shapeSuppressed) return;     // 动画进行中不上报：采样来自画布后备存储（静止姿态），
                                     // 而屏幕上是跳起/摆动中的猫——上报会重新套上裁掉耳朵
  } catch {}
}

/* 芯片命中排除：dock 可见时，其芯片屏幕矩形由主进程推送过来。
   光标落在这些矩形内时猫一律不命中——点击芯片永远不会被猫窗截胡。 */
let chipRects = [];
bridge?.onChipRects?.((r) => { chipRects = Array.isArray(r) ? r : []; });

function hitPet(x, y, wide) {
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
  const grow = wide ? alphaPad * (r.width / cvs.width) : 0;   // 外扩换算到屏幕 px
  if (x < r.left - grow || x > r.right + grow || y < r.top - grow || y > r.bottom + grow) return false;
  const map = wide ? alphaWide : alphaMap;
  if (!map) return true;   // SVG 皮肤：包围盒命中
  const cw = wide ? alphaWideW : cvs.width, ch = wide ? alphaWideH : cvs.height;
  const px = Math.floor((x - r.left + grow) / (r.width + grow * 2) * cw);
  const py = Math.floor((y - r.top + grow) / (r.height + grow * 2) * ch);
  if (px < 0 || py < 0 || px >= cw || py >= ch) return false;
  return map[py * cw + px] > 100;   // 阈值 100：素材光晕（alpha 10~80）不算猫
}
function overPet(x, y) { return hitPet(x, y, false); }   // 严格：猫本体
function nearPet(x, y) { return hitPet(x, y, true); }    // 宽松：含 8px 外扩（交互判定用）

/* 交互模型（setShape 版）：窗口常交互，形状外由 OS 原生穿透。
   不再用 setClickable 切换 ignoreMouseEvents——切换式模型存在
   「入场竞态」（光标从窗外直进透明区时第一击被残留的可交互态吞掉）。
   mousemove/cursor-pos 仅作诊断记录。 */
let lastMove = { x: -1, y: -1, over: null };
document.addEventListener("mousemove", (e) => {
  lastInteraction = Date.now();
  lastMove = { x: e.clientX, y: e.clientY, over: overPet(e.clientX, e.clientY) };
});

/* 拖拽姿态：主进程判定真实拖动后推送（被拎走的猫） */
bridge?.onDrag?.((v) => Pet?.setDrag?.(v));
bridge?.onDragPhys?.((v) => Pet?.setSwing?.(v.vx));   // 拖拽速度 → 拎起摆动激励

/* 主进程光标轮询（诊断）：观察 overPet 在真实光标位置的表现 */
bridge?.onCursorPos?.(({ inside, x, y }) => {
  if (inside) lastCursor = { x, y, over: overPet(x, y) };
});

/* ── 启动 ── */
poll();
setInterval(poll, 2500);
