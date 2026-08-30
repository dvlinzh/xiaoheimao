// mind-board-pet — Electron 主进程（src/main/main.js）
// 职责：
//   · 内嵌启动本地数据服务（127.0.0.1:13134）
//   · 透明无边框兔窗（贴右缘，可点击区域动态切换）
//   · 漫画气泡窗（点击 harness 图标弹出，单活跃）
//   · 全局热键 Ctrl+Alt+B 呼出/收起气泡
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, Tray, Menu, nativeImage } = require("electron");
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
let calWin = null;
let lastBubbleHarness = "";
let bubblePinned = false;   // 面板图钉：钉住时失焦/拖拽不收起
let bubbleShowAt = 0;       // 最近一次 show 的时间（blur 宽限期基准）
let dockShownAt = 0;        // 图标环最近一次弹出的时间（toggle 防抖基准）

const PET_W = 280, PET_H = 250;
const SWING_W = 320;                // 拖拽期间临时加宽：摆动的猫不被窗口左/右缘裁掉
const DOCK_W = 300, DOCK_H = 232;   // 图标环：120° 正圆扇形（R=75，圆心=标定十字）
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
/** 运行参数（ui 键）：每次读取最新值，标定工具改完即刻生效 */
function readUi() {
  try {
    const raw = JSON.parse(readFileSync(prefsFile(), "utf8"));
    return raw.ui || {};
  } catch { return {}; }
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
    // offset = 窗口底压入任务栏的深度（ui.pet.bury 可实时调）。
    const bury = Number(readUi().pet?.bury ?? 13);
    return { x: Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - PET_W - 4), y: wa.y + wa.height - PET_H + bury };
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
      // 穿透由 win.setShape（渲染层上报猫轮廓）负责；窗口本体保持可交互
    } catch (e) { log("[pet] show failed:", String(e)); }
  });
  petWin.webContents.on("did-fail-load", (_e, code, desc, url) =>
    log("[pet] load FAILED", code, desc, url));
  petWin.webContents.on("console-message", (_e, level, message, line, source) =>
    log("[pet:console]", message, `(${source}:${line})`));
  petWin.on("closed", () => { petWin = null; });
}

/** 唤起面板：强制重呈现（moveTop + 透明度轻推逼 DWM 重建表面）并刷新宽限基准 */
function summonBubble() {
  bubbleShowAt = Date.now();
  if (bubbleWin && !bubbleWin.isDestroyed()) {
    bubbleWin.show();
    bubbleWin.moveTop();
    bubbleWin.focus();
    // 透明窗「Electron 认为可见、屏幕上什么都没有」的幽灵态：
    // 轻推透明度强制 DWM 丢弃并重建表面，比 hide+show 平滑（无闪烁）
    try {
      bubbleWin.setOpacity(0.99);
      setTimeout(() => { try { bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.setOpacity(1); } catch {} }, 60);
    } catch {}
  }
}

async function openBubble(harness) {
  if (!harness) return;
  const url = `http://127.0.0.1:${port}/bubble.html?harness=${encodeURIComponent(harness)}&side=${petEdge}`;
  const reuse = bubbleWin && !bubbleWin.isDestroyed();
  // toggle 语义：面板正显示着这个 harness 时，再点同一芯片 = 收起
  if (reuse && lastBubbleHarness === harness && bubbleWin.isVisible()) {
    log("[bubble] toggle → hide (chip re-click)");
    bubbleWin.hide();
    return;
  }
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
  // 面板关闭只有两个途径：再点一次同一 harness 芯片（toggle）或 Esc。
  // 不再因点击别处/失焦隐藏——「点到别处面板就没了」是此前最大诟病。
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
  const pb = petWin.getBounds();
  // 圆心(ui.dock.cx/cy)是窗内坐标：dock 窗摆放使得 dock 内 (CX,CY)=(150,168)
  // 恰好落在窗内圆心上。ui 变化 → 标定工具实时生效。
  // 不做屏幕内钳制：一旦钳制，dock 窗相对猫滑动，芯片跟着漂（猫靠屏幕边缘时
  // 尤其明显）。窗口边框伸出屏外无碍——可见的只有芯片本身，它们始终钉在猫头。
  const ui = readUi().dock || {};
  const x = pb.x + Math.round((ui.cx ?? 95) - 150);
  const y = pb.y + Math.round((ui.cy ?? 95) - 168);
  dockWin.setPosition(x, y);
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
    // 环打开期间整窗可交互（标准弹层语义）：芯片可点、透明区吸收点击。
    // 此前的「按光标位置切换穿透」存在 100ms 采样竞态——点击落在切换
    // 相位就被穿透掉，表现为「点芯片没反应」，故彻底弃用。
    // 关闭途径不变：再点同一芯片 / 点猫身（toggle）/ 拖猫。
    if (dockWin && !dockWin.isDestroyed()) { try { dockWin.setIgnoreMouseEvents(false); } catch {} }
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
      dockWin.webContents.on("render-process-gone", (_e, details) =>
        log("[dock] render-process-gone:", JSON.stringify(details)));
      dockWin.webContents.once("did-finish-load", () => {
        // 环打开期间整窗可交互（标准弹层语义）；旧模型在此切穿透态，
        // 会在显示完成后把窗口永久切回穿透——点芯片无反应的元凶
        try { dockWin.setIgnoreMouseEvents(false); dockWin.moveTop(); } catch {}
      });
    } else {
      // 每次唤出强制重载页面：穿透窗渲染进程可能静默僵死/DOM 冻结在旧态
      // （曾整晚显示空环）。重载 ~200ms，换来的确定性远比速度重要。
      dockWin.hide();
      dockWin.loadURL(`http://127.0.0.1:${port}/dock.html`);
      dockWin.show();
      dockWin.moveTop();
    }
    positionDock();
  } else if (dockWin && !dockWin.isDestroyed() && dockWin.isVisible()) {
    // 淡出 120ms 后再隐藏，避免生硬消失（fade-out 在 dock.js）
    try { dockWin.webContents.send("dock-fade"); } catch {}
    setTimeout(() => {
      try {
        if (!dockWin || dockWin.isDestroyed()) return;
        dockWin.hide();
        chipRects = [];
        if (petWin && !petWin.isDestroyed()) petWin.webContents.send("chip-rects", []);
      } catch {}
    }, 130);
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

function showCalibrator(show) {
  if (show) {
    if (!calWin || calWin.isDestroyed()) {
      calWin = new BrowserWindow({
        width: 680, height: 600,
        backgroundColor: "#0d0d0f",
        autoHideMenuBar: true,
        title: "图标环 · 标定",
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      calWin.loadURL(`http://127.0.0.1:${port}/docs/ring-calibrator.html`);
    } else {
      calWin.show();
      calWin.focus();
    }
  } else if (calWin && !calWin.isDestroyed()) calWin.hide();
}
ipcMain.on("open-external", (_e, u) => {
  const s = String(u || "");
  if (/^https?:\/\//i.test(s) || s.startsWith("file:")) shell.openExternal(s.slice(0, 500));
});
ipcMain.on("dashboard-toggle", () => {
  const vis = dashWin && !dashWin.isDestroyed() && dashWin.isVisible();
  showDashboard(!vis);
});
ipcMain.on("dashboard-hide", () => showDashboard(false));
ipcMain.on("calibrator-toggle", () => {
  const vis = calWin && !calWin.isDestroyed() && calWin.isVisible();
  showCalibrator(!vis);
});

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
      // 阈值 ui.pet.dragThresh（默认 10）：手抖/触摸板抖动以前被误判成拖拽——
      // 图标环被藏掉、猫被拎起吸附。与 pet.js 单击判定（<6px）划清界限。
      const th = Number(readUi().pet?.dragThresh ?? 10);
      if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) < th) return;
      dragMoved = true;
      log("[drag] start at", JSON.stringify(b));
      try { petWin.webContents.send("drag-state", true); } catch {}
      showDock(false); showSettings(false);   // 拖猫不再收面板（关闭只经芯片 toggle / Esc）
      // 拖拽期间加宽窗口：摆动的尾巴/身体不再被窗口左缘裁掉。
      // 保持中心不动（视觉猫位置不变），并把 dragOff 补偿到新的窗口原点。
      // 高度同样 +14：CSS 摆动/底部下沉的余量。清空 setShape（拖拽期间
      // 渲染层不上报，见 pet.js），整窗可绘制无裁切。
      const growW = SWING_W - b.width, growH = 14;
      petWin.setBounds({
        x: b.x - (growW >> 1), y: b.y - (growH >> 1),
        width: SWING_W, height: b.height + growH,
      });
      dragOff.x += growW >> 1;
      dragOff.y += growH >> 1;
      try { petWin.setShape([]); } catch {}
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
  // 先把窗口复原到标准尺寸（保持猫的中心不动），吸附数学按标准尺寸进行
  const wb = petWin.getBounds();
  if (wb.width !== PET_W || wb.height !== PET_H) {
    petWin.setBounds({
      x: Math.round(wb.x + (wb.width - PET_W) / 2),
      y: Math.round(wb.y + (wb.height - PET_H) / 2),
      width: PET_W, height: PET_H,
    });
  }
  const b = petWin.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x + PET_W / 2, y: b.y + PET_H / 2 }).workArea;
  // 只吸附任务栏：水平自由摆放（钳制在屏内），垂直锁定任务栏落点
  petEdge = "taskbar";
  petXTB = Math.min(Math.max(b.x, wa.x + 4), wa.x + wa.width - PET_W - 4);
  petY = null;
  applyPetPos();
  saveUiPrefs();
  pushPrefs();
  log("[drag] end →", petEdge, JSON.stringify(petWin.getBounds()));
});

ipcMain.on("set-clickable", (_e, clickable) => {
  const win = BrowserWindow.fromWebContents(_e.sender);
  if (!win || win.isDestroyed()) return;
  if (win === petWin) return;   // 猫窗走 setShape 原生穿透，交互态不切换
  const who = win === petWin ? "pet" : win === dockWin ? "dock" : "other";
  log("[clickable]", who, "→", clickable);
  try { win.setIgnoreMouseEvents(!clickable, { forward: true }); } catch {}
});

/* 猫轮廓形状（win.setShape，Windows）：形状外 OS 原生点击穿透——
   透明区点击直达下层应用，无切换竞态。渲染层栅格化 alpha 膨胀区后上报。 */
ipcMain.on("pet-shape", (_e, rects) => {
  if (!petWin || petWin.isDestroyed() || !Array.isArray(rects) || !rects.length) return;
  try { petWin.setShape(rects); } catch (e) { log("[pet] setShape FAILED:", String(e)); }
});
ipcMain.on("dock-shape", (_e, rects) => {
  if (!dockWin || dockWin.isDestroyed() || !Array.isArray(rects) || !rects.length) return;
  try { dockWin.setShape(rects); } catch (e) { log("[dock] setShape FAILED:", String(e)); }
});

/* 悬停保活轮询：穿透窗的 hover 激活若依赖系统鼠标钩子转发，会被
   全屏应用/UAC 等环境事件摘除且永不恢复（猫变"可看不可点"）。
   主进程轮询光标位置主动驱动——getCursorScreenPoint 是普通 API，
   与 OS 事件投递状态完全解耦；渲染层 overPet 做逐像素判定。 */
/* 交互终版：主进程 100ms 轮询光标，光标在猫窗内=整窗可交互（离开=穿透）。
   不依赖系统鼠标钩子（会被全屏应用/UAC 摘除且永不恢复——渲染层收不到
   mousemove，猫永久点不到的根因）。点没点在猫身上由渲染层 overPet 判定。 */
let petInside = false;
setInterval(() => {
  if (!petWin || petWin.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  const b = petWin.getBounds();
  const inside = c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height;
  if (inside !== petInside) {
    petInside = inside;
    log("[pet] interactive →", inside);
    try { petWin.setIgnoreMouseEvents(!inside); } catch {}
  }
  if (inside) petWin.webContents.send("cursor-pos", { inside: true, x: c.x - b.x, y: c.y - b.y });

}, 100);

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
  // 只允许任务栏吸附：其他取值一律忽略
  if (v !== "taskbar") return;
  petEdge = "taskbar";
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

// 关键：禁用 Windows 原生遮挡计算。Chromium 会把被全屏应用覆盖的窗口标记为
// 「被遮挡」并停止合成；覆盖结束后该状态不恢复——透明窗表面被 DWM 丢弃，
// Electron 仍记为可见 → 猫/图标环/面板集体「幽灵可见」（看得见位置点不着，
// show() 全部无操作）。这是透明置顶窗的标准解法，必须在 app ready 前设置。
/* ── 系统托盘：左键/双击唤猫，右键菜单（设置/总览/躲猫猫/退出） ── */
let tray = null;
function showCat() {
  if (!petWin || petWin.isDestroyed()) { createPet(); return; }
  petWin.showInactive();
  petWin.moveTop();
}
function hideCat() {
  if (petWin && !petWin.isDestroyed()) petWin.hide();
}
function createTray() {
  const iconPath = path.join(__dirname, "../renderer/assets/tray.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);   // 32px 源，交由系统按 DPI 缩放（16px 缩小后偏小）
  tray.setToolTip("思维板 · 小黑猫");
  // 左键/双击：唤猫（隐藏时即打开）
  tray.on("click", showCat);
  tray.on("double-click", showCat);
  const menu = Menu.buildFromTemplate([
    { label: "显示猫猫", click: showCat },
    { label: "躲猫猫", click: hideCat },
    { type: "separator" },
    { label: "设置", click: () => showSettings(true) },
    { label: "项目总览", click: () => showDashboard(true) },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

app.whenReady().then(async () => {
  loadUiPrefs();
  try {
    const { startServer, onUiParams } = await import("../server/app.mjs");
    onUiParams(() => {
      positionDock();       // 圆心参数变了 → dock 窗跟着挪
      applyPetPos();        // 埋入深度变了 → 猫的落点也更新
    });
    const r = await startServer();
    port = r.port;
    log("[main] server ready, port:", port, "reused:", !!r.isReused);
    createPet();
    createTray();
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
