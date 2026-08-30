// dock.js — harness 图标环（小黑猫色系：暗色圆底 + harness 本尊图标）
// 布局：圆片以猫头为圆心、上半圆弧自动排布（1 枚在正头顶，多枚均布）。
// 恒驻：所有装过插件的 harness 常驻显示，不因不活跃消失；
//       10 分钟内有项目文件写盘（钩子 tick / MCP 整理）= 正在运行 → 主题色呼吸光效。
// 图标：assets/icons/<h>.png 存在就用实物图；没有则绘制兜底（dsh 用字母标，
//       把官方图标丢进 assets/icons/dsh.png 即自动替换）。
const ICON_COLOR = {
  "claude-code": "#fbbf24",   // 金圈
  dsh: "#5ea3f7",             // DeepSeek 蓝
  codex: "#5eead4",           // 青纹
  gemini: "#60a5fa",          // 拖尾蓝
  opencode: "#c8c8cc",        // 官方灰标
  other: "#6a6a72",
};
const LABELS = {
  "claude-code": "Claude", dsh: "DSH", codex: "Codex",
  gemini: "Gemini", opencode: "OpenCode", other: "其他",
};
const ICON_IMG = {
  "claude-code": "claude.png",
  opencode: "opencode.png",
  dsh: "dsh.png",             // 可能不存在，启动时探测
};
let LIVE_MS = 600000;            // 运行判定窗口，由 ui.dock.liveMs 每次刷新覆盖

const imgOk = {};   // 实物图标探测缓存
async function probeIcons() {
  await Promise.all(Object.entries(ICON_IMG).map(async ([h, f]) => {
    try {
      const r = await fetch("/assets/icons/" + f, { method: "HEAD" });
      imgOk[h] = r.ok;
    } catch { imgOk[h] = false; }
  }));
}

const ICONS = {
  // Gemini 四角星芒
  gemini: (c) => `<path fill="${c}" d="M20 2 Q22.2 16 36 18.4 Q22.2 20.8 20 36 Q17.8 20.8 4 18.4 Q17.8 16 20 2 Z"/>`,
  // Codex 六瓣环结
  codex: (c) => {
    let s = "";
    for (let i = 0; i < 6; i++) {
      s += `<rect x="17.2" y="3.4" width="5.6" height="14.5" rx="2.8" fill="${c}" transform="rotate(${i * 60} 20 20)"/>`;
    }
    return s;
  },
  // DSH 字母标（没有官方图时的兜底，不再画猜测的鲸）
  dsh: (c) => `<text x="20" y="27.5" text-anchor="middle" font-size="19" font-weight="800" fill="${c}" font-family="'Segoe UI',sans-serif">D</text>`,
  // 其他：爪印
  other: (c) => `<g fill="${c}"><ellipse cx="20" cy="27.6" rx="8.8" ry="7"/><ellipse cx="7.4" cy="17.6" rx="3.7" ry="4.7" transform="rotate(-24 7.4 17.6)"/><ellipse cx="15.4" cy="11.3" rx="3.8" ry="5.1" transform="rotate(-9 15.4 11.3)"/><ellipse cx="24.6" cy="11.3" rx="3.8" ry="5.1" transform="rotate(9 24.6 11.3)"/><ellipse cx="32.6" cy="17.6" rx="3.7" ry="4.7" transform="rotate(24 32.6 17.6)"/></g>`,
};

function iconSvg(h, size) {
  if (ICON_IMG[h] && imgOk[h]) {
    return `<img src="/assets/icons/${ICON_IMG[h]}" width="${size}" height="${size}" style="border-radius:50%;object-fit:contain" draggable="false" alt="">`;
  }
  const c = ICON_COLOR[h] || ICON_COLOR.other;
  const body = (ICONS[h] || ICONS.other)(c);
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

/* ── 环形布局：120° 正圆扇形。圆心 = 标定十字（窗内 95,92：水平在猫头中线、
 * 垂直在两眼之间）。一条边垂直（-90° 正头顶），另一条边斜向左下（-210°），
 * 芯片沿扇形等距分布；正圆恒定 R=75。吸附左缘时水平镜像。 ── */
let R = 75, CX = 150, CY = 168, SPAN = 120, START = -90;   // 由 ui.dock 实时刷新
let MIRROR = new URLSearchParams(location.search).get("edge") === "left" ? -1 : 1;
window.petBridge?.onPrefs?.((p) => { if (p?.edge) MIRROR = p.edge === "left" ? -1 : 1; });
function arcPos(i, n) {
  const deg = START - (SPAN / Math.max(1, n - 1)) * i;
  const rad = (deg * Math.PI) / 180;
  return { x: CX + MIRROR * R * Math.cos(rad), y: CY + R * Math.sin(rad) };
}


/* tooltip：JS 定位 + 窗口内收拢，不会再被裁 */
const tip = document.getElementById("tip");
function showTip(text, x, y) {
  tip.textContent = text;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = Math.min(Math.max(x - tw / 2, 4), 300 - tw - 4) + "px";
  // 芯片在窗口上半部 → tooltip 放芯片上方；贴顶则翻转到下方
  const top = y - 40;
  tip.style.top = (top < 2 ? y + 22 : top) + "px";
}
function hideTip() { tip.hidden = true; }

const seenKey = "mb.seen";
let seen = {};
let lastSig = null;
try { seen = JSON.parse(localStorage.getItem(seenKey) || "{}"); } catch {}

async function refresh() {
  try {
    const ov = await fetch("/api/overview").then((r) => r.json());
    const now = Date.now();
    const ud = ov.settings?.ui?.dock || {};
    R = ud.r ?? 75; SPAN = ud.span ?? 120; START = ud.start ?? -90; LIVE_MS = ud.liveMs ?? 600000;
    // 注意：CX/CY（芯片在 dock 客户区的圆心）是组件常量 150/168；
    // ui.dock.cx/cy 是窗内圆心，由主进程 positionDock 用于摆放窗口，dock.js 不消费
    const act = (ov.projects || []).filter((p) => p.active !== false);
    const by = {};
    for (const p of act) {
      const list = p.harnesses?.length ? p.harnesses : [p.harness || "other"];
      for (const h of list) {
        const e = by[h] || (by[h] = { gaps: 0, newest: 0, live: 0 });
        e.gaps += p.counts.gaps;
        e.newest = Math.max(e.newest, new Date(p.updatedAt).getTime());
        e.live = Math.max(e.live, p.liveAtMs || 0);
      }
    }
    // 所有装过插件的 harness 恒驻显示（不活跃不消失）；正在写的加光效
    const keys = Object.keys(by);
    keys.sort((a, b) => (a === "claude-code" ? -1 : b === "claude-code" ? 1 : a.localeCompare(b)));
    const modeOn = (ov.settings?.mode || "off") === "on";
    // 签名不变就不重建 DOM——3 秒轮询会把「正按着的芯片」换没，导致点击丢失
    const sig = keys.map((h) => {
      const live = now - by[h].live < LIVE_MS;
      return h + ":" + (live ? 1 : 0) + ":" + (by[h].newest > (seen[h] || 0) ? 1 : 0);
    }).join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    hideTip();
    let html = "";
    keys.forEach((h, i) => {
      const { x, y } = arcPos(i, keys.length);
      const live = now - by[h].live < LIVE_MS;   // 10 分钟内有写盘 = 正在运行
      const state = !modeOn ? "off" : live ? "on" : "idle";
      const tipText = `${LABELS[h] || h}｜${by[h].gaps ? "缺口 " + by[h].gaps + " · " : ""}${state === "on" ? "整理中" : state === "idle" ? "待命" : "整理模式关"}`;
      const hasNew = by[h].newest > (seen[h] || 0);
      const glow = state === "on" ? `--glow:${ICON_COLOR[h] || ICON_COLOR.other};` : "";
      html += `<div class="chip st-${state}" data-h="${encodeURIComponent(h)}" data-tip="${tipText}" data-x="${x}" data-y="${y}" style="left:${x}px;top:${y}px;animation-delay:${i * 40}ms;${glow}">`
        + `<span class="disc">${iconSvg(h, 26)}</span>`
        + `<span class="badge${hasNew ? " show" : ""}"></span></div>`;
    });
    console.log("[dock] rebuild, keys:", keys.join(","));
    // 排列坐标写出：每枚芯片在 dock 客户区与屏幕上的圆心位置
    const posLog = keys.map((h, i) => {
      const { x, y } = arcPos(i, keys.length);
      return `${h}:dock(${Math.round(x)},${Math.round(y)})`;
    }).join(" ");
    console.log("[dock] chip coords:", posLog,
      "| 圆心屏幕坐标:", `${Math.round(window.screenX + CX)}, ${Math.round(window.screenY + CY)}`);
    dock.innerHTML = html;   // 一个 harness 都没有时才留空
    dock.querySelectorAll(".chip").forEach((el) => {
      // pointerdown 即触发：click 会等 mouseup，若恰好赶上 3 秒轮询重建 DOM，
      // 按下的元素被换掉、click 丢失——表现为「点不到芯片」。防重入双保险。
      let fired = false;
      const openChip = () => {
        if (fired) return;
        fired = true;
        setTimeout(() => { fired = false; }, 500);
        const h = el.dataset.h;
        console.log("[dock] chip open:", h);
        seen[h] = Date.now();
        try { localStorage.setItem(seenKey, JSON.stringify(seen)); } catch {}
        const badge = el.querySelector(".badge");
        if (badge) badge.classList.remove("show");
        hideTip();
        window.petBridge?.openBubble(h);
      };
      el.addEventListener("pointerdown", openChip);
      el.addEventListener("click", openChip);
      el.addEventListener("mouseenter", () =>
        showTip(el.dataset.tip, Number(el.dataset.x), Number(el.dataset.y)));
      el.addEventListener("mouseleave", hideTip);
    });
    // 上报芯片矩形（外扩 8px 热区）：主进程换算屏幕坐标后推给猫窗做命中排除，
    // 保证「点芯片」永远不会被底下的猫窗截胡
    const rects = keys.map((h, i) => {
      const { x, y } = arcPos(i, keys.length);
      return { x: x - 30, y: y - 30, w: 60, h: 60 };
    });
    window.petBridge?.sendChipRects?.(rects);
    // 芯片矩形即窗口形状（win.setShape）：环的透明区原生穿透到下层（猫窗）。
    // 注意 setShape 同时会裁剪绘制区域——形状必须 ≥ 芯片+光晕外沿（±36px），
    // 否则光晕被方形裁剪（用户看到的「方形光效」即此）。
    window.petBridge?.sendDockShape?.(rects.map((r) => ({ x: r.x - 6, y: r.y - 6, width: r.w + 12, height: r.h + 12 })));
  } catch {}
}


probeIcons().then(refresh);
setInterval(refresh, 3000);
/* 隐藏期间定时器会被 Chromium 强节流（实测可到几十分钟一次）——每次显示时
 * 强制刷新并清签名，保证弹出来的环永远是新鲜芯片，而不是上次隐藏前的旧 DOM
 * （曾因此整个晚上环里都是「空 keys」的残留，用户看到的是没有图标的环）。 */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    dock.classList.remove("fade-out");
    lastSig = null;
    refresh();
  }
});
window.petBridge?.onDockFade?.(() => dock.classList.add("fade-out"));
