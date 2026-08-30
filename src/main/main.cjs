// mind-board-pet — Electron 主进程（src/main/main.js）
// 职责：
//   · 内嵌启动本地数据服务（127.0.0.1:13134）
//   · 透明无边框兔窗（贴右缘，可点击区域动态切换）
//   · 漫画气泡窗（点击 harness 图标弹出，单活跃）
//   · 全局热键 Ctrl+Alt+B 呼出/收起气泡
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell } = require("electron");
const path = require("node:path");
const { appendFileSync, readFileSync } = require("node:fs");

const LOG = path.join(process.env.MIND_BOARD_HOME || path.join(require("node:os").homedir(), ".mind-board"), "electron.log");
function log(...a) {
  try { appendFileSync(LOG, new Date().toISOString() + " " + a.join(" ") + "\n"); } catch {}
  console.log(...a);
}
process.on("unhandledRejection", (e) => log("[unhandledRejection]", e?.stack || String(e)));
process.on("uncaughtException", (e) => log("[uncaughtException]", e?.stack || String(e)));

let port = 13134;
let petWin = null;
let bubbleWin = null;
let dockWin = null;
let settingsWin = null;
let dashWin = null;
let lastBubbleHarness = "";
let bubblePinned = false;   // 面板图钉：钉住时失焦/拖拽不收起
let bubbleShowAt = 0;       // 最近一次 show 的时间（blur 宽限期基准）
let dockShownAt = 0;        // 图标环最近一次弹出的时间（toggle 防抖基准）

const PET_W = 190, PET_H = 220;
const DOCK_W = 300, DOCK_H = 240;   // 图标环：120° 扇形（垂直边 → 左下斜边，高度容下左下芯片）
const SET_W = 274, SET_H = 420;

/* 界面偏好（贴边/任务栏/置顶/位置），持久化在 settings.json 的附加键里 */
let petEdge = "right";        // right | left | taskbar
let petPin = true;
let petY = null;              // 边缘模式的纵向位置
let petXTB = null;            // 任务栏模式的横向位置
let panelW = 470, panelH = 660;   // 面板尺寸（拖边记忆）
let panelX = null, panelY = null; // 面板位置（拖动记忆，重启延续）
function prefsFile() {
  const dir = process.env.MIND_BOARD_HOME || path.join(require("node:os").homedir(), ".mind-board");
  return path.join(dir, "settings.json");
}
function loadUiPrefs() {
  try {
    const raw = JSON.parse(readFileSync(prefsFile(), "utf8"));
    if (["left", "right", "taskbar"].includes(raw.petEdge)) petEdge = raw.petEdge;
    if (typeof raw.petPin === "boolean") petPin = raw.petPin;
    if (Number.isFinite(raw.petY)) petY = raw.petY;
    if (Number.isFinite(raw.petXTB)) petXTB = raw.petXTB;
    if (Number.isFinite(raw.panelW)) panelW = Math.min(Math.max(raw.panelW, 380), 1200);
    if (Number.isFinite(raw.panelH)) panelH = Math.min(Math.max(raw.panelH, 500), 1400);
    if (Number.isFinite(raw.panelX)) panelX = raw.panelX;
    if (Number.isFinite(raw.panelY)) panelY = raw.panelY;
  } catch {}
}
function saveUiPrefs() {
  try {
    const f = prefsFile();
    let raw = {};
    try { raw = JSON.parse(readFileSync(f, "utf8")); } catch {}
    raw.petEdge = petEdge; raw.petPin = petPin; raw.petY = petY; raw.petXTB = petXTB;
    raw.panelW = panelW; raw.panelH = panelH;
    raw.panelX = panelX; raw.panelY = panelY;
    require("node:fs").writeFileSync(f, JSON.stringify(raw, null, 2));
  } catch {}
}
function pushPrefs() {
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send("ui-prefs", { edge: petEdge, pin: petPin });
  }
  positionDock();
  positionSettings();
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function petPos(wa) {
  if (petEdge === "taskbar") {
    const x = Number.isFinite(petXTB) ? petXTB : wa.x + Math.round((wa.width - PET_W) / 2);
    // 脚底对齐方案（皮肤按素材最低不透明行对齐画布底=窗口底）：
    // offset = 窗口底压入任务栏的深度。用户终选 ≈13px（坐实任务栏）。
    return { x: Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - PET_W - 4), y: wa.y + wa.height - PET_H + 13 };
  }
  const x = petEdge === "left" ? wa.x + 8 : wa.x + wa.width - PET_W - 8;
  const y = Number.isFinite(petY)
    ? Math.min(Math.max(petY, wa.y + 4), wa.y + wa.height - PET_H - 4)
    : Math.max(wa.y + Math.round((wa.height - PET_H) / 2), wa.y);
  return { x, y };
}

function applyPetPos() {
  if (!petWin || petWin.isDestroyed()) return;
  const p = petPos(workArea());
  petWin.setPosition(p.x, p.y);
}

function createPet() {
  const p = petPos(workArea());
  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: p.x,
    y: p.y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,          // 永不抢焦点
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 桌宠窗永不聚焦，Chromium 会对后台窗节流 rAF——呼吸/竖耳动画会整只冻住，必须关掉
      backgroundThrottling: false,
    },
  });
  petWin.setAlwaysOnTop(true, "screen-saver");
  petWin.loadURL(`http://127.0.0.1:${port}/pet.html`);
  petWin.webContents.on("did-finish-load", () => {
    log("[pet] loaded, bounds:", JSON.stringify(petWin.getBounds()));
    try {
      petWin.showInactive();
      petWin.moveTop();
      // 猫窗永久可交互（不再穿透）：透明像素的点击由渲染层 overPet 门控吸收
    } catch (e) { log("[pet] show failed:", String(e)); }
  });
  petWin.webContents.on("did-fail-load", (_e, code, desc, url) =>
    log("[pet] load FAILED", code, desc, url));
  petWin.webContents.on("console-message", (_e, level, message, line, source) =>
    log("[pet:console]", message, `(${source}:${line})`));
  petWin.on("closed", () => { petWin = null; });
}

/** 唤起面板：刷新 blur 宽限期基准（每次 show 都算一次「刚打开」），并尝试抢焦点 */
function summonBubble() {
  bubbleShowAt = Date.now();
  if (bubbleWin && !bubbleWin.isDestroyed()) {
    if (bubbleWin.isVisible()) {
      // 幽灵可见态：透明窗 blur 后 DWM 丢弃渲染表面，但 Electron 仍记为可见——
      // 此时 show() 是无操作，面板永远不再出现（须点两次才恢复）。
      // 强制 hide→show 踢掉幽灵态，顺便触发 show 事件刷新宽限基准。
      bubbleWin.hide();
      bubbleWin.show();
      log("[bubble] summon: hide+show（幽灵可见态修复）");
    } else {
      bubbleWin.show();
    }
    bubbleWin.focus();
  }
}

async function openBubble(harness) {
  if (!harness) return;
  const url = `http://127.0.0.1:${port}/bubble.html?harness=${encodeURIComponent(harness)}&side=${petEdge}`;
  const reuse = bubbleWin && !bubbleWin.isDestroyed();
  if (reuse && lastBubbleHarness === harness) {
    // 同一 harness：不重载（保留滚动位置），仅唤起
    summonBubble();
    positionBubble();
    return;
  }
  lastBubbleHarness = harness;
  if (reuse) {
    // 先显示再切内容：导航与显示同时发起时，透明窗可能在导航完成前保持不可见
    summonBubble();
    positionBubble();
    bubbleWin.loadURL(url);
    return;
  }
  bubbleShowAt = Date.now();   // show 事件会再刷一次，这里兜底防事件早于监听
  bubbleWin = new BrowserWindow({
    width: panelW, height: panelH,
    // 记忆位置：有就延续上次摆放（positionBubble 里再做屏幕内钳制），没有走避让逻辑
    x: Number.isFinite(panelX) ? panelX : undefined,
    y: Number.isFinite(panelY) ? panelY : undefined,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "noop-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  bubbleWin.setAlwaysOnTop(true, "screen-saver");   // 与猫/dock 同级，面板不被压在猫身下
  bubbleWin.loadURL(url);
  bubbleWin.webContents.on("did-fail-load", (_e, code, desc) =>
    log("[bubble] load FAILED", code, desc));
  bubbleWin.webContents.on("console-message", (_e, level, message, line, source) =>
    log("[bubble:console]", message, `(${source}:${line})`));
  // 点击面板以外的任何界面 → 自动收回（图钉钉住时例外）
  // 假失焦防护：从不可聚焦的 dock 窗/热键唤起时进程非前台，Windows 会在打开后
  // ~0.6s 强制收回焦点造成「闪开即关」——show 后 1.2s 内的 blur 直接忽略；
  // bubbleShowAt 在每次 show 事件刷新（覆盖复用窗口的再次唤起）。
  bubbleWin.on("blur", () => {
    const age = Date.now() - bubbleShowAt;
    log("[bubble] blur, pinned:", bubblePinned, "age:", age, "ms");
    if (bubblePinned) return;
    if (age < 1200) return;
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  });
  bubbleWin.on("show", () => {
    bubbleShowAt = Date.now();
    log("[bubble] shown, bounds:", JSON.stringify(bubbleWin.getBounds()));
  });
  // 拖动记忆：面板头部是 -webkit-app-region: drag，OS 直接挪窗口，Electron 仍会
  // 发 move 事件——防抖 400ms 落盘，重启后位置延续
  let moveSaveTimer = null;
  bubbleWin.on("move", () => {
    if (moveSaveTimer) return;
    moveSaveTimer = setTimeout(() => {
      moveSaveTimer = null;
      if (!bubbleWin || bubbleWin.isDestroyed()) return;
      const b = bubbleWin.getBounds();
      panelX = b.x; panelY = b.y;
      saveUiPrefs();
    }, 400);
  });
  positionBubble();
}

function closeBubble() {
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
}

function positionDock() {
  if (!petWin || petWin.isDestroyed() || !dockWin || dockWin.isDestroyed() || !dockWin.isVisible()) return;
  const wa = workArea();
  const pb = petWin.getBounds();
  // 圆环绕着猫：dock 窗以猫的水平中心为圆心，环心对准猫头（耳朵高度）
  // +85：环整体抬离头顶（原 +120 图标贴耳朵太近）
  const x = pb.x + Math.round(PET_W / 2 - DOCK_W / 2);
  const y = pb.y - DOCK_H + 182;   // dock 内圆心 (150,168) 对准猫头中心：dockY+168 = pb.y+110
  dockWin.setPosition(Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - DOCK_W - 4),
                      Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - DOCK_H - 4));
  // 关键：芯片区与猫窗范围重叠，猫窗任何一次 setPosition/激活都可能反压到 dock
  // 之上（表现为「点芯片点到的却是猫」）。dock 可见期间每次定位都重新压顶。
  dockWin.moveTop();
}

function positionSettings() {
  if (!petWin || petWin.isDestroyed() || !settingsWin || settingsWin.isDestroyed() || !settingsWin.isVisible()) return;
  const wa = workArea();
  const pb = petWin.getBounds();
  const b = settingsWin.getBounds();          // 高度自适应（fitHeight），用实际值定位
  // 贴猫侧面：水平贴猫侧边 6px，垂直与猫居中
  let x;
  if (petEdge === "taskbar") {
    x = pb.x - b.width - 6;                   // 默认左侧
    if (x < wa.x + 6) x = pb.x + PET_W + 6;   // 撞左墙换右侧
  } else {
    x = petEdge === "left" ? pb.x + PET_W + 6 : pb.x - b.width - 6;
    if (x < wa.x + 6) x = pb.x + PET_W + 6;
  }
  let y = Math.round(pb.y + (PET_H - b.height) / 2);   // 与猫垂直居中
  y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - b.height - 8);
  settingsWin.setPosition(x, y);
}

function showDock(show) {
  if (show) {
    dockShownAt = Date.now();
    if (!dockWin || dockWin.isDestroyed()) {
      dockWin = new BrowserWindow({
        width: DOCK_W, height: DOCK_H,
        transparent: true, frame: false, resizable: false,
        alwaysOnTop: true, hasShadow: false, focusable: false, skipTaskbar: true,
        webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
      });
      // 圆片会覆盖到猫窗区域（环绕头部），必须与猫窗同级置顶并压到最上——否则被猫窗挡住，看得见点不着
      dockWin.setAlwaysOnTop(true, "screen-saver");
      dockWin.loadURL(`http://127.0.0.1:${port}/dock.html`);
      dockWin.webContents.on("console-message", (_e, level, message, line, source) =>
        log("[dock:console]", message, `(${source}:${line})`));
      dockWin.webContents.once("did-finish-load", () => {
        try { dockWin.setIgnoreMouseEvents(true, { forward: true }); dockWin.moveTop(); } catch {}
      });
    } else { dockWin.show(); dockWin.moveTop(); }   // 每次唤出都重新压到猫窗之上，否则重叠区的芯片点不到
    positionDock();
  } else if (dockWin && !dockWin.isDestroyed()) {
    dockWin.hide();
    chipRects = [];
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send("chip-rects", []);
  }
}

function showSettings(show) {
  if (show) {
    if (!settingsWin || settingsWin.isDestroyed()) {
      settingsWin = new BrowserWindow({
        width: SET_W, height: SET_H,
        transparent: true, frame: false, resizable: false,
        alwaysOnTop: true, hasShadow: false, focusable: true, skipTaskbar: true,
        webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
      });
      // 点外面（失焦）自动收起——与气泡窗同款机制
      settingsWin.on("blur", () => {
        if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
      });
      settingsWin.loadURL(`http://127.0.0.1:${port}/settings.html`);
    } else settingsWin.show();
    positionSettings();
    positionBubble();   // 设置窗弹出后让思维面板避让（若开着）
  } else if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
}

ipcMain.on("dock-toggle", () => {
  const vis = dockWin && !dockWin.isDestroyed() && dockWin.isVisible();
  if (vis && Date.now() - dockShownAt < 1200) {
    // 刚弹出 1.2s 内的再点不收：用户连续快速点猫的意图是「出现图标」，
    // 不加防抖会 show→hide 闪一下又没了（观感即「点了没有图标」）
    log("[dock] toggle → ignored (debounce)");
    return;
  }
  log("[dock] toggle →", vis ? "hide" : "show");
  showDock(!vis);
});

/* ── 面板拖边缩放：渲染层抓边条上报方向，主进程跟随光标调窗口 ── */
const PANEL_MIN_W = 380, PANEL_MIN_H = 500;
let panelResize = null;
let panelResizeTimer = null;
ipcMain.on("panel-resize-start", (_e, edge) => {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  panelResize = { edge: String(edge || ""), b: bubbleWin.getBounds(), c: screen.getCursorScreenPoint() };
  clearInterval(panelResizeTimer);
  panelResizeTimer = setInterval(() => {
    if (!panelResize || !bubbleWin || bubbleWin.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    const dx = c.x - panelResize.c.x, dy = c.y - panelResize.c.y;
    const wa = workArea();
    const e = panelResize.edge;
    let { x, y, width, height } = panelResize.b;
    if (e.includes("e")) width = Math.min(Math.max(width + dx, PANEL_MIN_W), wa.width - 40);
    if (e.includes("s")) height = Math.min(Math.max(height + dy, PANEL_MIN_H), wa.height - 40);
    if (e.includes("w")) { const w2 = Math.min(Math.max(width - dx, PANEL_MIN_W), wa.width - 40); x += width - w2; width = w2; }
    if (e.includes("n")) { const h2 = Math.min(Math.max(height - dy, PANEL_MIN_H), wa.height - 40); y += height - h2; height = h2; }
    bubbleWin.setBounds({ x, y, width, height });
  }, 16);
});
ipcMain.on("panel-resize-end", () => {
  clearInterval(panelResizeTimer);
  if (panelResize && bubbleWin && !bubbleWin.isDestroyed()) {
    const b = bubbleWin.getBounds();
    panelW = b.width; panelH = b.height;
    panelX = b.x; panelY = b.y;
    saveUiPrefs();
  }
  panelResize = null;
});
ipcMain.on("dock-hide", () => showDock(false));

/* ── 芯片命中排除：dock 上报芯片客户区矩形 → 换算屏幕坐标 → 推给猫窗。
   猫窗在 overPet 里对这些矩形返回「不命中」，点击芯片永远不会被猫窗截胡
   （此前 dock 与猫的 z-order/穿透竞争造成「点芯片点到的却是猫」）。 ── */
let chipRects = [];
ipcMain.on("chip-rects", (_e, rects) => {
  chipRects = Array.isArray(rects) ? rects : [];
  const d = dockWin && !dockWin.isDestroyed() ? dockWin.getContentBounds() : null;
  const screenRects = d ? chipRects.map((r) => ({ ...r, x: r.x + d.x, y: r.y + d.y })) : [];
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send("chip-rects", screenRects);
});
ipcMain.on("settings-toggle", () => showSettings(!settingsWin || settingsWin.isDestroyed() || !settingsWin.isVisible()));
ipcMain.on("settings-hide", () => showSettings(false));

/* ── 项目总览仪表盘：普通窗口（有标题栏、进任务栏），管理模式用 ── */
function showDashboard(show) {
  if (show) {
    if (!dashWin || dashWin.isDestroyed()) {
      dashWin = new BrowserWindow({
        width: 1160, height: 800,
        backgroundColor: "#0d0d0f",
        autoHideMenuBar: true,
        title: "思维板 · 项目总览",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      dashWin.loadURL(`http://127.0.0.1:${port}/dashboard.html`);
    } else {
      dashWin.show();
      dashWin.focus();
    }
  } else if (dashWin && !dashWin.isDestroyed()) dashWin.hide();
}
ipcMain.on("dashboard-toggle", () => {
  const vis = dashWin && !dashWin.isDestroyed() && dashWin.isVisible();
  showDashboard(!vis);
});
ipcMain.on("dashboard-hide", () => showDashboard(false));

function positionBubble() {
  if (!petWin || petWin.isDestroyed() || !bubbleWin || bubbleWin.isDestroyed()) return;
  const wa = workArea();
  const pb = petWin.getBounds();
  const b = bubbleWin.getBounds();
  // 有记忆位置（用户拖过）→ 只做屏幕内钳制，不再自动归位到猫侧
  if (Number.isFinite(panelX) && Number.isFinite(panelY)) {
    const x = Math.min(Math.max(panelX, wa.x + 8), wa.x + wa.width - b.width - 8);
    const y = Math.min(Math.max(panelY, wa.y + 8), wa.y + wa.height - b.height - 8);
    bubbleWin.setPosition(x, y);
    return;
  }
  let x, y;
  if (petEdge === "taskbar") {
    // 站任务栏：思维面板放猫侧面（垂直居中猫身）
    x = pb.x - b.width - 8;
    if (x < wa.x + 8) x = pb.x + PET_W + 8;
    y = pb.y + Math.round((PET_H - b.height) / 2);
  } else if (petEdge === "right") {
    x = pb.x - b.width - 6;
    y = Math.round(pb.y + (pb.height - b.height) / 2);
  } else {
    x = pb.x + PET_W + 6;
    y = Math.round(pb.y + (pb.height - b.height) / 2);
  }
  // 避让设置窗：设置窗贴猫优先，气泡与它重叠就往外侧让
  if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) {
    const sb = settingsWin.getBounds();
    const overlap = x < sb.x + sb.width && x + b.width > sb.x && y < sb.y + sb.height && y + b.height > sb.y;
    if (overlap) {
      if (x + b.width / 2 < sb.x + sb.width / 2) x = sb.x - b.width - 6;   // 气泡在左 → 让到设置窗左边
      else x = sb.x + sb.width + 6;                                       // 气泡在右 → 让到设置窗右边
    }
  }
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - b.width - 8);
  y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - b.height - 8);
  bubbleWin.setPosition(x, y);
}

/* ── 兔子拖拽：主进程循环跟随光标（支持多显示器），松手贴边 ── */
let dragging = false;
let dragMoved = false;
let dragOff = { x: 0, y: 0 };
let dragPrevX = null;   // 上一帧光标 x（拖拽速度激励）
let dragTimer = null;
ipcMain.on("drag-start", () => {
  if (!petWin || petWin.isDestroyed() || dragging) return;
  const p = screen.getCursorScreenPoint();
  const b = petWin.getBounds();
  dragging = true;
  dragMoved = false;
  dragOff = { x: p.x - b.x, y: p.y - b.y };
  dragTimer = setInterval(() => {
    if (!dragging || !petWin || petWin.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    // 拖拽物理：水平速度发给渲染层（拎起晃动的激励源）
    const vx = dragPrevX === null ? 0 : c.x - dragPrevX;
    dragPrevX = c.x;
    try { petWin.webContents.send("drag-phys", { vx }); } catch {}
    if (!dragMoved) {
      // 阈值 10px：手抖/触摸板抖动（3~6px）以前会被误判成拖拽——图标环被藏掉、
      // 猫被拎起吸附，用户的「单击唤环」几乎永远失败。与 pet.js 的单击判定
      // （<6px）划清界限：<6 单击，6~10 忽略，≥10 拖拽。
      if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) < 10) return;
      dragMoved = true;
      log("[drag] start at", JSON.stringify(b));
      try { petWin.webContents.send("drag-state", true); } catch {}
      if (!bubblePinned) closeBubble();
      showDock(false); showSettings(false);
    }
    const wa = screen.getDisplayNearestPoint(c).workArea;   // 跟随光标所在显示器
    const nx = Math.min(Math.max(c.x - dragOff.x, wa.x - PET_W + 90), wa.x + wa.width - 90);
    const ny = Math.min(Math.max(c.y - dragOff.y, wa.y + 4), wa.y + wa.height - PET_H - 4);
    petWin.setPosition(nx, ny);
  }, 16);
});
ipcMain.on("drag-end", () => {
  dragPrevX = null;
  if (!dragging) return;
  dragging = false;
  clearInterval(dragTimer);
  if (!dragMoved) return;      // 单击：不吸附不落盘
  try { petWin.webContents.send("drag-state", false); } catch {}
  if (!petWin || petWin.isDestroyed()) return;
  const b = petWin.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x + PET_W / 2, y: b.y + PET_H / 2 }).workArea;
  // 三向吸附：左缘 / 右缘 / 任务栏（窗口底边离任务栏顶最近者胜）
  const dLeft = Math.abs(b.x - wa.x);
  const dRight = Math.abs(wa.x + wa.width - (b.x + PET_W));
  const taskbarTop = wa.y + wa.height;
  const dTask = Math.abs(taskbarTop - (b.y + PET_H));
  if (dTask <= dLeft && dTask <= dRight) {
    petEdge = "taskbar";
    petXTB = Math.min(Math.max(b.x, wa.x + 4), wa.x + wa.width - PET_W - 4);
    petY = null;
  } else if (dLeft <= dRight) {
    petEdge = "left";
    petY = b.y;
  } else {
    petEdge = "right";
    petY = b.y;
  }
  applyPetPos();
  saveUiPrefs();
  pushPrefs();
  log("[drag] end →", petEdge, JSON.stringify(petWin.getBounds()));
});

ipcMain.on("set-clickable", (_e, clickable) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win || win.isDestroyed()) return;
  if (win === petWin) return;   // 猫窗永久可交互，任何渲染层都不得切穿透
  try { win.setIgnoreMouseEvents(!clickable, { forward: true }); } catch {}
});

/* 交互机制（终版）：猫窗不再使用任何点击穿透/激活切换。
   历史教训：穿透窗依赖系统鼠标钩子转发做「悬停激活」，钩子会被全屏
   应用/UAC 摘除且永不恢复，激活总是慢于点击（心跳实证 down:0/up:8，
   mousedown 全被穿透吞掉）。现在猫窗永久可交互：所有点击都到达渲染层，
   是否点在猫身上由渲染层 overPet 按像素判定，透明像素的点击吸收不动。
   代价：悬停猫窗矩形期间下层应用收不到点击（桌面宠标准取舍）。 */

ipcMain.on("bubble-pinned", (_e, v) => { bubblePinned = !!v; });

ipcMain.on("open-bubble", (_e, payload) => {
  log("[bubble] open request:", payload?.harness || "(empty)");
  openBubble(payload?.harness || lastBubbleHarness || "");
});

ipcMain.on("close-bubble", () => closeBubble());

ipcMain.on("quit", () => app.quit());

ipcMain.handle("get-state", () => ({
  edge: petEdge,
  pin: petPin,
  autostart: app.isPackaged && app.getLoginItemSettings().openAtLogin,
  isDev: !app.isPackaged,
}));
ipcMain.on("hide-pet", () => { if (petWin && !petWin.isDestroyed()) petWin.hide(); });
ipcMain.on("show-pet", () => { if (petWin && !petWin.isDestroyed()) { petWin.showInactive(); petWin.moveTop(); } });
ipcMain.on("set-pin", (_e, v) => {
  petPin = !!v;
  if (petWin && !petWin.isDestroyed()) petWin.setAlwaysOnTop(petPin, "screen-saver");
  saveUiPrefs(); pushPrefs();
});
ipcMain.on("set-edge", (_e, v) => {
  if (!["left", "right", "taskbar"].includes(v)) return;
  petEdge = v;
  applyPetPos();
  saveUiPrefs(); pushPrefs();
});
ipcMain.on("set-autostart", (_e, v) => {
  try { app.setLoginItemSettings({ openAtLogin: !!v }); } catch {}
  pushPrefs();
});
/* 设置窗高度自适应内容（行数少了，不需要滚动条） */
ipcMain.on("set-win-height", (_e, h) => {
  if (!settingsWin || settingsWin.isDestroyed() || !h) return;
  const b = settingsWin.getBounds();
  const wa = workArea();
  const nh = Math.min(Math.max(h, 120), wa.height - 40);
  if (Math.abs(nh - b.height) < 2) return;
  const y = Math.min(b.y, wa.y + wa.height - nh - 8);
  settingsWin.setBounds({ x: b.x, y: Math.max(y, wa.y + 8), width: b.width, height: nh });
  positionSettings();   // 高度变化后底边重新对齐猫头顶（否则会压到猫身上）
});
ipcMain.on("open-data-dir", () => {
  const dir = process.env.MIND_BOARD_HOME || path.join(require("node:os").homedir(), ".mind-board");
  shell.openPath(dir);
});

app.whenReady().then(async () => {
  loadUiPrefs();
  try {
    const { startServer } = await import("../server/app.mjs");
    const r = await startServer();
    port = r.port;
    log("[main] server ready, port:", port, "reused:", !!r.isReused);
    createPet();
  } catch (e) {
    log("[main] startup FAILED:", e?.stack || String(e));
    return;
  }

  globalShortcut.register("Control+Alt+B", async () => {
    if (!petWin || petWin.isDestroyed()) createPet();
    else if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) bubbleWin.hide();
    else openBubble(lastBubbleHarness || await firstHarness());
  });
  // Ctrl+Alt+H：躲起来 / 唤回兔子
  globalShortcut.register("Control+Alt+H", () => {
    if (!petWin || petWin.isDestroyed()) return createPet();
    if (petWin.isVisible()) petWin.hide();
    else { petWin.showInactive(); petWin.moveTop(); }
  });

  app.on("activate", () => { if (!petWin || petWin.isDestroyed()) createPet(); });
});

app.on("before-quit", () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on("window-all-closed", () => app.quit());

/** 数据里最近活跃的 harness（供热键冷启动用） */
async function firstHarness() {
  try {
    const { overview } = await import("../core/store.mjs");
    const now = Date.now();
    const by = {};
    for (const p of overview().projects) {
      for (const h of (p.harnesses?.length ? p.harnesses : [p.harness || "other"])) {
        by[h] = Math.max(by[h] || 0, p.liveAtMs || 0);
      }
    }
    const live = Object.entries(by).filter(([, t]) => now - t < 10 * 60 * 1000)
      .sort((a, b) => b[1] - a[1]);
    return live[0]?.[0] || "";
  } catch { return ""; }
}
