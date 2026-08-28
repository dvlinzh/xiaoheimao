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
let lastBubbleHarness = "";
let bubblePinned = false;   // 面板图钉：钉住时失焦/拖拽不收起

const PET_W = 190, PET_H = 220;
const DOCK_W = 168, DOCK_H = 96;
const SET_W = 226, SET_H = 420;

/* 界面偏好（贴边/任务栏/置顶/位置），持久化在 settings.json 的附加键里 */
let petEdge = "right";        // right | left | taskbar
let petPin = true;
let petY = null;              // 边缘模式的纵向位置
let petXTB = null;            // 任务栏模式的横向位置
let panelW = 470, panelH = 660;   // 面板尺寸（拖边记忆）
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
  } catch {}
}
function saveUiPrefs() {
  try {
    const f = prefsFile();
    let raw = {};
    try { raw = JSON.parse(readFileSync(f, "utf8")); } catch {}
    raw.petEdge = petEdge; raw.petPin = petPin; raw.petY = petY; raw.petXTB = petXTB;
    raw.panelW = panelW; raw.panelH = panelH;
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
    // 脚底位置标定（本机实测）：素材脚底在窗口底上方约 8px
    // （idle 14 素材像素 × 0.42 画布缩放 + 2px 画布内边距）。
    // offset = 窗口底压入任务栏的深度 = 脚底相对任务栏上沿的位置：
    //   12 → 脚沉入 4px；8 → 踩线；10 → 微微埋进任务栏上沿（用户终选：
    //   脚盖住任务栏，而不是被任务栏盖住，配合置顶层渲染）。
    return { x: Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - PET_W - 4), y: wa.y + wa.height - PET_H + 10 };
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
      petWin.setIgnoreMouseEvents(true, { forward: true });
    } catch (e) { log("[pet] show failed:", String(e)); }
  });
  petWin.webContents.on("did-fail-load", (_e, code, desc, url) =>
    log("[pet] load FAILED", code, desc, url));
  petWin.webContents.on("console-message", (_e, level, message, line, source) =>
    log("[pet:console]", message, `(${source}:${line})`));
  petWin.on("closed", () => { petWin = null; });
}

async function openBubble(harness) {
  if (!harness) return;
  const url = `http://127.0.0.1:${port}/bubble.html?harness=${encodeURIComponent(harness)}&side=${petEdge}`;
  const reuse = bubbleWin && !bubbleWin.isDestroyed();
  if (reuse && lastBubbleHarness === harness) {
    // 同一 harness：不重载（保留滚动位置），仅唤起
    bubbleWin.show();
    positionBubble();
    return;
  }
  lastBubbleHarness = harness;
  if (reuse) {
    bubbleWin.loadURL(url);
    bubbleWin.show();
    positionBubble();
    return;
  }
  bubbleWin = new BrowserWindow({
    width: panelW, height: panelH,
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
  bubbleWin.setAlwaysOnTop(true, "floating");
  bubbleWin.loadURL(url);
  // 点击面板以外的任何界面 → 自动收回（图钉钉住时例外）
  bubbleWin.on("blur", () => {
    if (bubblePinned) return;
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
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
  let x, y;
  if (petEdge === "taskbar") {
    // 圆片贴头顶：dock 内容贴窗底，底缘 ≈ 头顶上方 10px
    x = pb.x + PET_W - DOCK_W + 10; y = pb.y - 30;
  } else if (petEdge === "right") {
    x = pb.x - DOCK_W - 8; y = pb.y + Math.round((PET_H - DOCK_H) / 2);
  } else {
    x = pb.x + PET_W + 8; y = pb.y + Math.round((PET_H - DOCK_H) / 2);
  }
  dockWin.setPosition(Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - DOCK_W - 4),
                      Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - DOCK_H - 4));
}

function positionSettings() {
  if (!petWin || petWin.isDestroyed() || !settingsWin || settingsWin.isDestroyed() || !settingsWin.isVisible()) return;
  const wa = workArea();
  const pb = petWin.getBounds();
  const b = settingsWin.getBounds();          // 高度自适应（fitHeight），用实际值定位
  let x = petEdge === "left" ? pb.x + PET_W + 10 : pb.x - b.width - 10;
  if (x < wa.x + 8) x = pb.x + PET_W + 10;
  // 像对话框：底边对齐猫头顶附近，向上伸展；顶部放不下则下沉到猫下方
  let y = pb.y - b.height + 46;
  if (y < wa.y + 12) y = pb.y + PET_H + 10;
  y = Math.min(Math.max(y, wa.y + 12), wa.y + wa.height - b.height - 14);
  settingsWin.setPosition(x, y);
}

function showDock(show) {
  if (show) {
    if (!dockWin || dockWin.isDestroyed()) {
      dockWin = new BrowserWindow({
        width: DOCK_W, height: DOCK_H,
        transparent: true, frame: false, resizable: false,
        alwaysOnTop: true, hasShadow: false, focusable: false, skipTaskbar: true,
        webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
      });
      dockWin.loadURL(`http://127.0.0.1:${port}/dock.html`);
      dockWin.webContents.once("did-finish-load", () => {
        try { dockWin.setIgnoreMouseEvents(true, { forward: true }); } catch {}
      });
    } else dockWin.show();
    positionDock();
  } else if (dockWin && !dockWin.isDestroyed()) dockWin.hide();
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
  } else if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
}

ipcMain.on("dock-toggle", () => showDock(!dockWin || dockWin.isDestroyed() || !dockWin.isVisible()));

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
    saveUiPrefs();
  }
  panelResize = null;
});
ipcMain.on("dock-hide", () => showDock(false));
ipcMain.on("settings-toggle", () => showSettings(!settingsWin || settingsWin.isDestroyed() || !settingsWin.isVisible()));
ipcMain.on("settings-hide", () => showSettings(false));

function positionBubble() {
  if (!petWin || petWin.isDestroyed() || !bubbleWin || bubbleWin.isDestroyed()) return;
  const wa = workArea();
  const pb = petWin.getBounds();
  const b = bubbleWin.getBounds();
  let x, y;
  if (petEdge === "taskbar") {
    // 站任务栏：气泡悬在头顶侧方
    x = pb.x - b.width - 8;
    if (x < wa.x + 8) x = pb.x + PET_W + 8;
    y = pb.y - b.height + 46;
  } else if (petEdge === "right") {
    x = pb.x - b.width - 6;
    y = Math.round(pb.y + (pb.height - b.height) / 2);
  } else {
    x = pb.x + PET_W + 6;
    y = Math.round(pb.y + (pb.height - b.height) / 2);
  }
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - b.width - 8);
  y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - b.height - 8);
  bubbleWin.setPosition(x, y);
}

/* ── 兔子拖拽：主进程循环跟随光标（支持多显示器），松手贴边 ── */
let dragging = false;
let dragMoved = false;
let dragOff = { x: 0, y: 0 };
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
    if (!dragMoved) {
      // 按住未动 = 可能只是单击，先不收面板
      if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) < 3) return;
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
  try { win.setIgnoreMouseEvents(!clickable, { forward: true }); } catch {}
});

/* 悬停保活轮询：穿透窗的 hover 激活依赖系统鼠标钩子转发，实测会被
   全屏游戏/UAC 遮罩等环境事件摘除且永不恢复（猫变"可看不可点"）。
   改由主进程轮询光标位置主动驱动穿透切换——getCursorScreenPoint 是
   普通 API，不依赖任何钩子，与 OS 事件投递状态完全解耦。 */
setInterval(() => {
  if (!petWin || petWin.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  const b = petWin.getBounds();
  if (c.x < b.x || c.x >= b.x + b.width || c.y < b.y || c.y >= b.y + b.height) {
    petWin.webContents.send("cursor-pos", { inside: false });
    return;
  }
  petWin.webContents.send("cursor-pos", { inside: true, x: c.x - b.x, y: c.y - b.y });
}, 100);

ipcMain.on("bubble-pinned", (_e, v) => { bubblePinned = !!v; });

ipcMain.on("open-bubble", (_e, payload) => {
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

  globalShortcut.register("Control+Alt+B", () => {
    if (!petWin || petWin.isDestroyed()) createPet();
    else if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) bubbleWin.hide();
    else openBubble(lastBubbleHarness || firstHarness());
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

/** 数据里第一个 harness（供热键冷启动用） */
function firstHarness() {
  return "";
}
