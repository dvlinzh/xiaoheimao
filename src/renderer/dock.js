// dock.js — harness 图标条（小黑猫色系：暗色圆底 + harness 本尊图标）
// 有官方原图（assets/icons/<h>.png）用原图；没有的用简化绘制版。
const ICON_COLOR = {
  "claude-code": "#fbbf24",   // 金圈
  dsh: "#a855f7",             // 紫焰
  codex: "#5eead4",           // 青纹
  gemini: "#60a5fa",          // 拖尾蓝
  opencode: "#c8c8cc",        // 官方灰标
  other: "#6a6a72",
};
const LABELS = {
  "claude-code": "Claude", dsh: "DSH", codex: "Codex",
  gemini: "Gemini", opencode: "OpenCode", other: "其他",
};

const seenKey = "mb.seen";
let seen = {};
try { seen = JSON.parse(localStorage.getItem(seenKey) || "{}"); } catch {}

const ICON_IMG = {
  "claude-code": "claude.png",   // Claude 官方托盘星芒（本机桌面端资源）
  opencode: "opencode.png",      // OpenCode 官方 exe 图标
};

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
  // DSH 鲸影
  dsh: (c) => `<path fill="${c}" d="M3.5 23.5 C9 13.5 20 9.5 28 12.5 C32.5 14.2 35 17.8 35 21.5 C35 24.6 32.2 26.6 28.6 25.8 C22 24.4 13 25.6 7.5 25.2 C4.8 25 2.8 24.6 3.5 23.5 Z M27.5 11.5 C29.5 7.5 33.5 5.5 36.5 6 C34.8 8.8 34.2 11.8 34.5 14.6 C36.6 12.4 38.8 11.6 38.2 15.4 C37.8 17.8 35.6 19.6 33.2 19.2 L29.5 15.8 Z"/>`,
  // 其他：爪印
  other: (c) => `<g fill="${c}"><ellipse cx="20" cy="27.6" rx="8.8" ry="7"/><ellipse cx="7.4" cy="17.6" rx="3.7" ry="4.7" transform="rotate(-24 7.4 17.6)"/><ellipse cx="15.4" cy="11.3" rx="3.8" ry="5.1" transform="rotate(-9 15.4 11.3)"/><ellipse cx="24.6" cy="11.3" rx="3.8" ry="5.1" transform="rotate(9 24.6 11.3)"/><ellipse cx="32.6" cy="17.6" rx="3.7" ry="4.7" transform="rotate(24 32.6 17.6)"/></g>`,
};

function iconSvg(h, size) {
  if (ICON_IMG[h]) {
    return `<img src="/assets/icons/${ICON_IMG[h]}" width="${size}" height="${size}" style="border-radius:50%;object-fit:contain" draggable="false" alt="">`;
  }
  const c = ICON_COLOR[h] || ICON_COLOR.other;
  const body = (ICONS[h] || ICONS.other)(c);
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

async function refresh() {
  try {
    const ov = await fetch("/api/overview").then((r) => r.json());
    const act = (ov.projects || []).filter((p) => p.active !== false);
    const by = {};
    for (const p of act) {
      const list = p.harnesses?.length ? p.harnesses : [p.harness || "other"];
      for (const h of list) {
        const e = by[h] || (by[h] = { gaps: 0, newest: 0 });
        e.gaps += p.counts.gaps;
        e.newest = Math.max(e.newest, new Date(p.updatedAt).getTime());
      }
    }
    const keys = Object.keys(by);
    keys.sort((a, b) => (a === "claude-code" ? -1 : b === "claude-code" ? 1 : a.localeCompare(b)));
    const modeOn = (ov.settings?.mode || "off") === "on";
    const now = Date.now();
    let html = "";
    for (const h of keys) {
      // 明暗 = 思维助手状态；红点 = 有新整理未查看
      const newest = by[h].newest;
      const alive = modeOn && newest > 0 && (now - newest) < 30 * 60 * 1000;
      const state = !modeOn ? "off" : alive ? "on" : "idle";
      const tip = `${LABELS[h] || h}｜${state === "on" ? "整理中" : state === "idle" ? "待命（30 分钟没动静）" : "整理模式关"}`;
      const hasNew = newest > (seen[h] || 0);
      html += `<div class="chip st-${state}" data-h="${encodeURIComponent(h)}" data-tip="${tip}">`
        + `<span class="disc">${iconSvg(h, 24)}</span>`
        + `<span class="badge${hasNew ? " show" : ""}"></span></div>`;
    }
    dock.innerHTML = html || `<div class="chip" data-tip="还没有任务"><span class="disc">${iconSvg("other", 24)}</span></div>`;
    dock.querySelectorAll(".chip").forEach((el) => {
      el.addEventListener("click", () => {
        const h = el.dataset.h;
        seen[h] = Date.now();
        try { localStorage.setItem(seenKey, JSON.stringify(seen)); } catch {}
        const badge = el.querySelector(".badge");
        if (badge) badge.classList.remove("show");
        window.petBridge?.openBubble(h);
      });
    });
  } catch {}
}

/* 逐片命中：默认穿透，悬停到圆片才可点击——透明区域不挡底下界面 */
let clickable = false;
function setClickable(c) {
  if (c === clickable) return;
  clickable = c;
  window.petBridge?.setClickable(c);
}
document.addEventListener("mousemove", (e) => {
  setClickable(!!e.target.closest?.(".chip"));
});
document.addEventListener("mouseout", (e) => { if (!e.relatedTarget) setClickable(false); });

refresh();
setInterval(refresh, 3000);
