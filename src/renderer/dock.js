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
const LIVE_MS = 10 * 60 * 1000;   // 10 分钟内有写盘 = 正在运行（亮光效；否则灰显待命）

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

/* ── 环形布局：圆心 = 猫头（dock 窗底中点对准头部高度），芯片沿头周弧线非对称散布 ── */
const R = 80;                 // 半径：比耳廓稍远一档
const CX = 150, CY = 168;     // 圆心（dock 窗 300×200，(150,168) 对准猫头中心）
/* 每档数量一组预设角（度，-90=正头顶）：扇形从头部左下扫到右侧
 * （-165° 左耳下 → -20° 右耳上），间距不等、非镜像——圆心始终是猫头。 */
const ARC_ANGLES = {
  1: [-78],
  2: [-122, -28],
  3: [-150, -78, -24],
  4: [-162, -112, -60, -22],
  5: [-165, -124, -84, -48, -18],
};
function arcPos(i, n) {
  if (n <= 5) {
    const deg = ARC_ANGLES[n][i];
    const rad = (deg * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
  }
  // n>5：上半弧均布兜底
  const deg = -180 + (180 / (n - 1)) * i;
  const rad = (deg * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
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
      html += `<div class="chip st-${state}" data-h="${encodeURIComponent(h)}" data-tip="${tipText}" data-x="${x}" data-y="${y}" style="left:${x}px;top:${y}px;${glow}">`
        + `<span class="disc">${iconSvg(h, 26)}</span>`
        + `<span class="badge${hasNew ? " show" : ""}"></span></div>`;
    });
    console.log("[dock] rebuild, keys:", keys.join(","));
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
  } catch {}
}

/* 逐片命中：默认穿透，悬停到圆片才可点击——透明区域不挡底下界面 */
let clickable = false;
function setClickable(c) {
  if (c === clickable) return;
  clickable = c;
  console.log("[dock] clickable →", c);
  window.petBridge?.setClickable(c);
}
document.addEventListener("mousemove", (e) => {
  setClickable(!!e.target.closest?.(".chip"));
});
document.addEventListener("mouseout", (e) => {
  if (!e.relatedTarget) {
    // innerHTML 重建会合成 mouseout(relatedTarget=null)。若光标实际仍悬停在
    // 某个芯片上（重建后 DOM 的 :hover 依旧匹配），下一帧按真实悬停恢复——
    // 否则静止的光标不再产生 mousemove，悬停态被误杀后第一次点击必穿透
    setTimeout(() => setClickable(!!document.querySelector(".chip:hover")), 0);
  }
});

probeIcons().then(refresh);
setInterval(refresh, 3000);
/* 隐藏期间定时器会被 Chromium 强节流（实测可到几十分钟一次）——每次显示时
 * 强制刷新并清签名，保证弹出来的环永远是新鲜芯片，而不是上次隐藏前的旧 DOM
 * （曾因此整个晚上环里都是「空 keys」的残留，用户看到的是没有图标的环）。 */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastSig = null;
    refresh();
  }
});
