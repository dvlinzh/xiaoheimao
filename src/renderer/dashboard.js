// dashboard.js — 项目总览仪表盘：聚合 /api/overview，一屏管理全部项目
const $ = (s) => document.querySelector(s);
const grid = $("#grid");
const stateEl = { q: "", harness: "", state: "", sort: "recent", showArchived: false };
let lastOv = null;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function relTime(ts) {
  if (!ts) return "—";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  return d < 30 ? d + " 天前" : Math.floor(d / 30) + " 个月前";
}

function openCard(p) {
  const h = p.harnesses?.[0] || p.harness || "other";
  // 项目选中意图经 localStorage 传递（面板与仪表盘同源），面板刷新时拾取
  try { localStorage.setItem("mb.projSel", p.id); } catch {}
  if (window.petBridge?.openBubble) {
    window.petBridge.openBubble(h);       // 应用内面板（主进程管理）
  } else {
    // 纯浏览器模式兜底：新开面板页
    window.open(`/bubble.html?harness=${encodeURIComponent(h)}&project=${encodeURIComponent(p.id)}`,
      "mindboard-panel", "width=470,height=660");
  }
}

function render() {
  if (!lastOv) return;
  const now = Date.now();
  const projects = lastOv.projects || [];

  /* 统计条 */
  const active = projects.filter((p) => p.active !== false);
  const totalGaps = active.reduce((s, p) => s + (p.counts?.gaps || 0), 0);
  const pending = projects.filter((p) => p.pendingNewTask).length;
  const liveH = new Set();
  for (const p of active) for (const h of (p.harnesses || [])) {
    if (p.liveAtMs && now - p.liveAtMs < 10 * 60 * 1000) liveH.add(h);
  }
  $("#stats").innerHTML = `
    <span class="stat"><b>${projects.length}</b><span>项目</span></span>
    <span class="stat"><b>${active.length}</b><span>30 天活跃</span></span>
    <span class="stat ${totalGaps ? "warn" : ""}"><b>${totalGaps}</b><span>未解缺口</span></span>
    <span class="stat ${pending ? "warn" : ""}"><b>${pending}</b><span>待确认新目标</span></span>
    <span class="stat live"><b>${liveH.size}</b><span>运行中工具</span></span>`;

  /* harness 筛选片 */
  const hset = {};
  for (const p of active) for (const h of (p.harnesses || [])) hset[h] = (hset[h] || 0) + 1;
  $("#hchips").innerHTML = `<span class="hchip ${stateEl.harness === "" ? "on" : ""}" data-h="">全部</span>` +
    Object.keys(hset).sort().map((h) =>
      `<span class="hchip ${stateEl.harness === h ? "on" : ""}" data-h="${esc(h)}">${esc(h)} ${hset[h]}</span>`).join("");

  /* 过滤 + 排序 */
  const q = stateEl.q.trim().toLowerCase();
  let list = projects.filter((p) => {
    if (!stateEl.showArchived && p.state === "reflected") return false;
    if (stateEl.harness && !(p.harnesses || []).includes(stateEl.harness)) return false;
    if (stateEl.state && p.state !== stateEl.state) return false;
    if (q) {
      const hay = ((p.title || "") + " " + (p.currentGoal || "")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (stateEl.sort === "recent") {
    list.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  } else if (stateEl.sort === "gaps") {
    list.sort((a, b) => (b.counts?.gaps || 0) - (a.counts?.gaps || 0));
  } else if (stateEl.sort === "name") {
    list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }

  /* 卡片 */
  grid.innerHTML = list.map((p) => {
    const c = p.counts || {};
    const goal = p.currentGoal || "";
    const agoS = relTime(Date.parse(p.updatedAt) || 0);
    const hs = (p.harnesses || []).map((h) => `<span class="htag">${esc(h)}</span>`).join("");
    return `<div class="pc" data-id="${esc(p.id)}" data-h="${esc((p.harnesses || [])[0] || "other")}">
      <div class="row1">
        <span class="title" title="${esc(p.title)}">${esc(p.title)}</span>
        <span class="badge ${esc(p.state)}">${esc(p.state)}</span>
      </div>
      <div class="goal ${goal ? "has" : ""}" title="${esc(goal)}">${goal ? "🎯 " + esc(goal) : "🎯 目标未定"}</div>
      <div class="counts">
        <span class="cnt">想法 <b>${(c.ideas || 0) + (c.doneIdeas || 0)}</b></span>
        <span class="cnt">要点 <b>${c.points || 0}</b></span>
        <span class="cnt">方案 <b>${c.plans || 0}</b></span>
        <span class="cnt gaps ${c.gaps ? "warn" : ""}">缺口 <b>${c.gaps || 0}</b></span>
      </div>
      ${p.pendingNewTask ? `<div class="pending">⚠ 有未确认的新目标</div>` : ""}
      <div class="hrow">${hs}<span class="ago">${agoS}</span></div>
      <button class="arch">${p.state === "reflected" ? "恢复" : "归档"}</button>
      <button class="open">打开面板 →</button>
    </div>`;
  }).join("");
  $("#empty").hidden = list.length > 0;

  grid.querySelectorAll(".pc").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".arch")) return;   // 归档按钮自己处理
      const p = projects.find((x) => x.id === el.dataset.id);
      if (p) openCard(p);
    });
    el.querySelector(".arch")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const p = projects.find((x) => x.id === el.dataset.id);
      if (!p) return;
      const act = p.state === "reflected" ? "reopen" : "archive";
      await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: p.id, action: act }) });
      poll();
    });
  });
}

async function poll() {
  try {
    lastOv = await fetch("/api/overview").then((r) => r.json());
    render();
  } catch {}
}

/* 交互 */
$("#q").addEventListener("input", (e) => { stateEl.q = e.target.value; render(); });
$("#f-state").addEventListener("change", (e) => { stateEl.state = e.target.value; render(); });
$("#f-sort").addEventListener("change", (e) => { stateEl.sort = e.target.value; render(); });
$("#hchips").addEventListener("click", (e) => {
  const h = e.target.dataset?.h;
  if (h !== undefined) { stateEl.harness = h; render(); }
});
$("#f-arch").addEventListener("change", (e) => { stateEl.showArchived = e.target.checked; render(); });
$("#btn-close").addEventListener("click", () => window.petBridge?.closeDashboard());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.petBridge?.closeDashboard(); });

poll();
setInterval(poll, 5000);
