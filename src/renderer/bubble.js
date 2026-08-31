// mind-board-pet — 气泡面板逻辑（src/renderer/bubble.js）
const $ = (s) => document.querySelector(s);

const ICON_COLOR = {
  "claude-code": "#fbbf24", dsh: "#a855f7", codex: "#5eead4",
  gemini: "#60a5fa", opencode: "#c8c8cc", other: "#6a6a72",
};
const LABELS = {
  "claude-code": "Claude", dsh: "DSH", codex: "Codex",
  gemini: "Gemini", opencode: "OpenCode", other: "其他",
};

const ICON_IMG = {
  "claude-code": "claude.png",
  opencode: "opencode.png",
};

const ICONS = {
  gemini: (c) => `<path fill="${c}" d="M20 2 Q22.2 16 36 18.4 Q22.2 20.8 20 36 Q17.8 20.8 4 18.4 Q17.8 16 20 2 Z"/>`,
  codex: (c) => {
    let s = "";
    for (let i = 0; i < 6; i++) {
      s += `<rect x="17.2" y="3.4" width="5.6" height="14.5" rx="2.8" fill="${c}" transform="rotate(${i * 60} 20 20)"/>`;
    }
    return s;
  },
  dsh: (c) => `<path fill="${c}" d="M3.5 23.5 C9 13.5 20 9.5 28 12.5 C32.5 14.2 35 17.8 35 21.5 C35 24.6 32.2 26.6 28.6 25.8 C22 24.4 13 25.6 7.5 25.2 C4.8 25 2.8 24.6 3.5 23.5 Z M27.5 11.5 C29.5 7.5 33.5 5.5 36.5 6 C34.8 8.8 34.2 11.8 34.5 14.6 C36.6 12.4 38.8 11.6 38.2 15.4 C37.8 17.8 35.6 19.6 33.2 19.2 L29.5 15.8 Z"/>`,
  other: (c) => `<g fill="${c}"><ellipse cx="20" cy="27.6" rx="8.8" ry="7"/><ellipse cx="7.4" cy="17.6" rx="3.7" ry="4.7" transform="rotate(-24 7.4 17.6)"/><ellipse cx="15.4" cy="11.3" rx="3.8" ry="5.1" transform="rotate(-9 15.4 11.3)"/><ellipse cx="24.6" cy="11.3" rx="3.8" ry="5.1" transform="rotate(9 24.6 11.3)"/><ellipse cx="32.6" cy="17.6" rx="3.7" ry="4.7" transform="rotate(24 32.6 17.6)"/></g>`,
};

function iconSvg(h, size) {
  if (ICON_IMG[h]) {
    return `<img src="/assets/icons/${ICON_IMG[h]}" width="${size}" height="${size}" style="border-radius:50%;object-fit:contain;vertical-align:-3px" draggable="false" alt="">`;
  }
  const c = ICON_COLOR[h] || ICON_COLOR.other;
  const body = (ICONS[h] || ICONS.other)(c);
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="filter:drop-shadow(0 0 5px ${c}59);vertical-align:-3px" aria-hidden="true">${body}</svg>`;
}

let harness = new URLSearchParams(location.search).get("harness") || localStorage.getItem("mb.harness") || "";
if (harness) try { localStorage.setItem("mb.harness", harness); } catch {}

// 兔子在左时气泡在其右侧，尾巴翻向左边
if (new URLSearchParams(location.search).get("side") === "left") {
  document.documentElement.classList.add("side-left");
}
// Esc 关闭面板（钉住时也有效，属明确指令）
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.close(); });

/* ── 关闭按钮：等同 Esc（项目总览按钮已砍——与头部项目下拉重复，看板走猫菜单） ── */
const pinBtn = $("#btn-pin");
pinBtn.title = "关闭面板（Esc 同效）";
pinBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6 18 18"/></svg>`;
pinBtn.addEventListener("click", () => window.close());

function fitHeight() {
  const b = document.getElementById("wrap").getBoundingClientRect();
  window.petBridge?.setWinHeight?.(Math.min(Math.max(Math.ceil(b.bottom), 120), 900));
}
setTimeout(fitHeight, 200);
setInterval(fitHeight, 2000);   // 内容增高窗口跟着长（对齐设置窗策略）

let curProjectId = null;
let curSkeleton = null;
let curSummary = null;

async function jfetch(url, body) {
  const opt = body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : {};
  const r = await fetch(url, opt);
  return r.json();
}

/* ── 项目选择 ── */
function pickDefaultProject(ov) {
  if (!harness) {
    // 未指定 harness：取第一个有项目的组
    for (const p of ov.projects) { return { list: [p], name: p.harnesses?.[0] || p.harness || "other" }; }
    return { list: [], name: "" };
  }
  const list = ov.projects.filter((p) => (p.harnesses || []).includes(harness) || p.harness === harness);
  return { list, name: harness };
}

/* ── 项目切换走 ☰ 总览（只列当前 harness 参与过的项目）；顶部名字只管改名 ── */
let projList = [];
const projTrigger = $("#proj-trigger");

function renderProjTrigger(ov) {
  projList = pickDefaultProject(ov).list;
  const cur = projList.find((p) => p.id === curProjectId);
  $("#proj-name").textContent = cur?.title || (projList[0]?.title || "思维板");
}

/* 触发器：点名字 → 改名 */
projTrigger.addEventListener("click", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.target.closest("#proj-name") && curProjectId) startRenameProject();
});

function startRenameProject() {
  const el = $("#proj-name");
  if (!el) return;
  const old = el.textContent;
  const input = document.createElement("input");
  input.className = "proj-name-input";
  input.type = "text";
  input.value = old;
  input.maxLength = 30;
  el.replaceWith(input);
  input.id = "proj-name";
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    const span = document.createElement("span");
    span.id = "proj-name";
    span.textContent = (commit && v) ? v : old;
    input.replaceWith(span);
    if (commit && v && v !== old) {
      await jfetch("/api/action", { projectId: curProjectId, action: "rename-project", params: { title: v } });
      loadSkeleton(true);
    }
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
}

function selectProject(id) {
  curProjectId = id;
  loadSkeleton(true);
}

/* ── 骨架渲染 ── */
async function loadSkeleton(force = false) {
  if (!curProjectId) return;
  const data = await jfetch(`/api/skeleton?id=${encodeURIComponent(curProjectId)}`);
  if (!data || !data.summary) return;
  curSummary = data.summary;
  curSkeleton = data.skeleton;
  renderChrome(data.summary);
  renderLayers(curSkeleton);
}

function renderChrome(s) {
  $("#h-glyph").innerHTML = iconSvg(harness || "other", 16);
  const nameEl = document.getElementById("proj-name");
  if (nameEl && nameEl.tagName === "SPAN") nameEl.textContent = s.title;
  $("#pending-banner").hidden = !s.pendingNewTask;
}

/* 维度进度：价值/结构/路径三维各自的完成度（按记录骨架下限计） */
function renderHp(c) {
  const bar = $("#hp-bar");
  const segs = 9;   // 九模块
  const mins = { anchor:1, audience:1, proposition:1, modules:3, skeleton:2, boundaries:2, link:3, bottlenecks:1, feedback:1 };
  let done = 0, total = 0;
  const dims = curSkeleton?.goals?.find((g) => g.id === curSkeleton?.currentGoalId)?.dims;
  for (const [mod, min] of Object.entries(mins)) {
    total++;
    const dim = mod === "anchor" || mod === "audience" || mod === "proposition" ? "why" : mod === "link" || mod === "bottlenecks" || mod === "feedback" ? "how" : "what";
    if ((dims?.[dim]?.[mod] || []).length >= min) done++;
  }
  bar.replaceChildren();
  for (let i = 0; i < segs; i++) {
    const cell = document.createElement("i");
    if (i < done) cell.className = "f";
    bar.appendChild(cell);
  }
  bar.classList.toggle("low", done <= segs * 0.3);
  $("#hp-text").textContent = done + "/" + segs + " 模块";
}

function goalOf(sk) {
  if (!sk || !Array.isArray(sk.goals)) return null;
  return sk.goals.find((g) => g.id === sk.currentGoalId) || sk.goals[0] || null;
}

/* 目标竖排：当前目标 22px 大字（点击改名），其余纯文字行（点击切换），末尾虚线新建 */
function renderGoalList(sk) {
  const box = $("#goal-list");
  box.replaceChildren();
  if (!sk || !sk.goals?.length) return;
  const goals = sk.goals.slice(-6).reverse();
  goals.sort((a, b) => (a.id === sk.currentGoalId ? -1 : b.id === sk.currentGoalId ? 1 : 0));   // 当前目标置顶
  for (const g of goals) {
    if (g.id === sk.currentGoalId) {
      const el = document.createElement("div");
      el.className = "mt-goal-current";
      el.textContent = g.title || I18N.t("goal.untitled");
      el.title = I18N.t("goal.rename") + " · " + I18N.t("dz.del");
      el.addEventListener("click", () => startEditGoal(g.id, g.title || "", el));
      bindItemDrag(el, { id: g.id }, g.title || I18N.t("goal"), { action: "remove-goal" });
      box.appendChild(el);
    } else {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mt-goal-tab";
      b.textContent = g.title || I18N.t("goal.untitled");
      b.title = I18N.t("goal.switch") + " · " + I18N.t("dz.del");
      b.addEventListener("click", async () => {
        await jfetch("/api/action", { projectId: curProjectId, action: "switch-goal", params: { id: g.id } });
        loadSkeleton(true);
      });
      bindItemDrag(b, { id: g.id }, g.title || I18N.t("goal.untitled"), { action: "remove-goal" });
      box.appendChild(b);
    }
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "mt-goal-add";
  add.textContent = I18N.t("goal.new");
  add.title = I18N.t("goal.new");
  add.addEventListener("click", () => startNewGoal(box, add));
  box.appendChild(add);
}

/* 当前目标改名：就地换输入框，Enter/失焦保存，Esc 取消 */
function startEditGoal(goalId, oldTitle, host) {
  const input = document.createElement("input");
  input.className = "mt-goal-input";
  input.type = "text";
  input.value = oldTitle;
  input.maxLength = 24;
  host.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    const back = document.createElement("div");
    back.className = "mt-goal-current";
    back.textContent = (commit && v) ? v : oldTitle;
    back.title = "点击改名";
    back.addEventListener("click", () => startEditGoal(goalId, (commit && v) ? v : oldTitle, back));
    input.replaceWith(back);
    if (commit && v && v !== oldTitle) {
      await jfetch("/api/action", { projectId: curProjectId, action: "rename-goal", params: { id: goalId, title: v } });
      loadSkeleton(true);
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/* 新建目标：虚线按钮换成输入框，Enter/失焦有名字才真建，空名直接丢弃 */
function startNewGoal(box, addBtn) {
  const input = document.createElement("input");
  input.className = "mt-inline-input";
  input.type = "text";
  input.placeholder = "新目标名（≤24字）…";
  input.maxLength = 24;
  addBtn.replaceWith(input);
  input.focus();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.replaceWith(addBtn);
    if (commit && v) {
      await jfetch("/api/action", { projectId: curProjectId, action: "new-goal", params: { title: v } });
      loadSkeleton(true);
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/* ── 想法自动归纳：同 group 归一组（默认折叠），无 group 平铺，已实现收进折叠区 ── */
const expGroup = {};   // { "ideas:组名": true } 展开态（内存保持，刷新不丢）

function mkIdeaLi(it) {
  const li = mkLi(it.done ? "ideas-done" : "", { layer: "ideas", id: it.id });
  if (it.raw) li.title = "原话：" + it.raw;   // 归纳前的用户原话（可追溯）
  li.appendChild(mkSpan("li-mark", it.done ? "●" : "○"));
  li.appendChild(mkSpan("li-text", it.text));
  // 已实现标记走「拖到绿区」的显式动作——点击行不再误触翻转
  bindItemDrag(li, { layer: "ideas", id: it.id }, it.text, { canToggle: true });
  return li;
}

function mkGroupHead(label, count, isOpen, extraCls, onToggle) {
  const head = document.createElement("li");
  head.className = "grp-head" + (extraCls ? " " + extraCls : "");
  const hint = document.createElement("span");
  hint.className = "grp-hint";
  hint.textContent = isOpen ? "⌄" : "›";
  const nm = document.createElement("span");
  nm.className = "grp-name";
  nm.textContent = label;
  const cnt = document.createElement("span");
  cnt.className = "grp-count";
  cnt.textContent = count;
  head.append(hint, nm, cnt);
  head.addEventListener("click", onToggle);
  return head;
}

function mkLi(className) {
  const li = document.createElement("li");
  li.className = className;
  return li;
}
function mkSpan(cls, text) {
  const s = document.createElement("span");
  s.className = cls; s.textContent = text;
  return s;
}
/* 九模块提示文案键（i18n 暂无 → 直接用中文） */
const HINT_KEYS = {
  anchor: "记触发场景/痛点", audience: "记核心受众特征", proposition: "一句话价值主张",
  modules: "功能拆解：模块+职责", skeleton: "删掉就垮的骨架", boundaries: "明确不做",
  link: "流程步骤", bottlenecks: "缺什么/卡在哪", feedback: "信息如何回流",
};

function hintLi(text) {   // 空层占位提示（重构时曾被删定义——空层一渲染就抛错，后续层全部消失）
  const li = document.createElement("li");
  li.className = "hint";
  li.textContent = text;
  return li;
}
function renderLayer(listEl, dim, mod, goal) {
  listEl.replaceChildren();
  const arr = goal?.dims?.[dim]?.[mod] || [];
  if (!arr.length) { listEl.appendChild(hintLi(HINT_KEYS[mod] || "")); return; }
  for (const it of arr) {
    const li = mkLi("", { layer: mod, id: it.id });
    li.appendChild(mkSpan("li-mark", "▸"));
    li.appendChild(mkSpan("li-text", it.text ?? it.title));
    bindItemDrag(li, { dim, mod, id: it.id }, it.text ?? it.title);
    listEl.appendChild(li);
  }
}

function renderLayers(sk) {
  const goal = goalOf(sk);
  const c = curSummary?.counts || {};
  renderHp(c);
  // 九模块计数徽标
  const dimCount = (dim, mod) => (goal?.dims?.[dim]?.[mod] || []).length;
  const setC = (id, n) => { const el = $("#" + id); if (el) el.textContent = n ? String(n) : ""; };
  setC("c-anchor", dimCount("why","anchor")); setC("c-audience", dimCount("why","audience")); setC("c-proposition", dimCount("why","proposition"));
  setC("c-modules", dimCount("what","modules")); setC("c-skeleton", dimCount("what","skeleton")); setC("c-boundaries", dimCount("what","boundaries"));
  setC("c-link", dimCount("how","link")); setC("c-bottlenecks", dimCount("how","bottlenecks")); setC("c-feedback", dimCount("how","feedback"));
  if (!goal) return;
  renderGoalList(sk);
  renderLayer($("#list-anchor"), "why", "anchor", goal);
  renderLayer($("#list-audience"), "why", "audience", goal);
  renderLayer($("#list-proposition"), "why", "proposition", goal);
  renderLayer($("#list-modules"), "what", "modules", goal);
  renderLayer($("#list-skeleton"), "what", "skeleton", goal);
  renderLayer($("#list-boundaries"), "what", "boundaries", goal);
  renderLayer($("#list-link"), "how", "link", goal);
  renderLayer($("#list-bottlenecks"), "how", "bottlenecks", goal);
  renderLayer($("#list-feedback"), "how", "feedback", goal);
}

/* ── 拖边缩放：抓边条 → 主进程跟随光标 ── */
document.querySelectorAll(".rz").forEach((el) => {
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.bubbleBridge?.resizeStart(el.dataset.dir);
  });
});
window.addEventListener("mouseup", () => window.bubbleBridge?.resizeEnd());
window.addEventListener("blur", () => window.bubbleBridge?.resizeEnd());

/* ── 拖动删除 / 标记已实现 ──
   按住条目拖走 → 底部滑入「标记已实现」（仅想法）与「删除」两区；松手落在哪个区就生效。
   两区平时 hidden，只有拖动时才出现（原版策略）。 */
let drag = null;
const DRAG_MIN = 6;   // 超过 6px 才算拖，避免误触

/* opts: { action 删除动作名（默认 remove-item）, canToggle 是否可拖到绿区标记已实现 } */
function bindItemDrag(el, payload, text, opts = {}) {
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".li-del")) return;      // 点 × 不拖
    if (e.target.tagName === "INPUT") return;     // 改名输入框内不拖
    drag = {
      payload, text, li: el, sx: e.clientX, sy: e.clientY, active: false,
      action: opts.action || "remove-item",
      canToggle: !!opts.canToggle,
      project: opts.project || null,   // 总览视图：拖的是整个项目（落删除区 → 二次确认）
    };
  });
}

function inRect(e, el) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}
function zoneAt(e) {
  const t = document.getElementById("togg-zone");
  const d = document.getElementById("del-zone");
  if (t && !t.hidden && inRect(e, t)) return "toggle";
  if (d && !d.hidden && inRect(e, d)) return "del";
  return null;
}
function showZones(show) {
  const canToggle = !!drag?.canToggle;
  const t = document.getElementById("togg-zone");
  const d = document.getElementById("del-zone");
  if (t) t.hidden = !(show && canToggle);
  if (d) d.hidden = !show;
}
function armZone(zone) {
  const t = document.getElementById("togg-zone");
  const d = document.getElementById("del-zone");
  t?.classList.toggle("armed", zone === "toggle");
  d?.classList.toggle("armed", zone === "del");
}
function endDrag() {
  // 移除所有残留 ghost（拖到窗口外松手可能留下幽灵卡片）
  document.querySelectorAll(".drag-ghost").forEach((el) => el.remove());
  showZones(false);
  armZone(null);
  document.querySelectorAll(".drag-src").forEach((el) => el.classList.remove("drag-src"));
}
// 窗口失焦/鼠标离开文档也收尾，防残留
window.addEventListener("blur", () => { if (drag) { drag = null; endDrag(); } });
document.addEventListener("mouseleave", () => { if (drag) { drag = null; endDrag(); } });

document.addEventListener("mousemove", (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_MIN) return;
    drag.active = true;
    drag.li.classList.add("drag-src");
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = drag.text;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    showZones(true);
  }
  drag.ghost.style.left = e.clientX + "px";
  drag.ghost.style.top = e.clientY + "px";
  armZone(zoneAt(e));
});

document.addEventListener("mouseup", async (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.active) return;
  // 任何完成的拖拽都抑制紧随其后的 click：drop 已生效的动作不被条目
  // 自身的 click 处理器二次触发（项目删除尤其不能删完又切进去）
  ovSuppress = true;
  setTimeout(() => { ovSuppress = false; }, 0);
  const zone = zoneAt(e);
  endDrag();
  if (!zone) return;
  if (zone === "del") {
    if (d.project) { confirmDeleteProject(d.project); return; }   // 项目拖删 → 二次确认
    const r = await jfetch("/api/action", { projectId: curProjectId, action: d.action, params: d.payload });
    if (r && r.ok === false && r.message) {
      // 例如「至少要留一个目标」：轻提示，不静默失败
      const dz = document.getElementById("del-zone");
      if (dz) { const old = dz.textContent; dz.textContent = r.message; setTimeout(() => { dz.textContent = old; }, 1600); }
    }
    loadSkeleton(true);
  } else if (zone === "toggle" && d.canToggle) {
    await jfetch("/api/action", { projectId: curProjectId, action: "toggle-done", params: { id: d.payload.id } });
    loadSkeleton(true);
  }
});

/* ── 主轮询 ── */
/* ── 总览视图：一屏看全部项目，点行切换（跨 harness 经 reload 重载） ── */
let lastOv = null;
let projSelDone = false;
let ovMode = false;
let ovSuppress = false;   // 拖拽松手后抑制紧随的 click（删除意图≠切换意图）

function setOvMode(v) {
  ovMode = v;
  document.querySelector(".comic")?.classList.toggle("mode-ov", v);
  const view = document.getElementById("overview-view");
  if (view) view.hidden = !v;
  if (v) renderOv();
}

function renderOv() {
  const box = document.getElementById("ov-list");
  if (!box || !lastOv) return;
  // 只列当前 harness 参与过的项目（多 harness 项目在每个侧都可见、可正常切换）
  const list = [...(lastOv.projects || [])]
    .filter((p) => !harness || (p.harnesses || []).includes(harness) || p.harness === harness)
    .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  box.replaceChildren(...list.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ov-item" + (p.id === curProjectId ? " on" : "");
    const c = p.counts || {};
    const stateTxt = { draft: "构思", clarifying: "推进", reflected: "已沉淀" }[p.state] || p.state;
    const meta = document.createElement("span");
    meta.className = "ov-meta";
    // 不用 innerHTML：stateTxt 有 p.state 兜底分支，项目记录可被导入数据投毒
    if (c.gaps) { const b = document.createElement("b"); b.textContent = `缺口 ${c.gaps}`; meta.append(b, document.createTextNode(" · ")); }
    meta.append(document.createTextNode(stateTxt));
    const row1 = document.createElement("span");
    row1.className = "ov-row1";
    const dot = document.createElement("i");
    dot.className = "ov-dot " + (p.state || "");
    const name = document.createElement("span");
    name.className = "ov-name";
    name.textContent = p.title || p.id;
    const tag = document.createElement("span");
    tag.className = "ov-tag";
    tag.textContent = (p.harnesses || [])[0] || "";
    row1.append(dot, name, meta, tag);
    const goal = document.createElement("span");
    goal.className = "ov-goal";
    goal.textContent = p.currentGoal ? "🎯 " + p.currentGoal : "🎯 目标未定";
    b.append(row1, goal);
    b.title = "点击切换项目 · 按住拖到底部删除区可删除";
    bindItemDrag(b, null, p.title || p.id, { project: p });   // 拖到底部红区 → 二次确认删除
    b.addEventListener("click", () => {
      if (ovSuppress) return;   // 拖拽松手后的 click：删除意图，不切换
      const h = (p.harnesses || [])[0] || p.harness || "other";
      if ((p.harnesses || []).includes(harness) || p.harness === harness) {
        selectProject(p.id);
        setOvMode(false);
      } else {
        // 跨 harness：换面板身份并重载（URL/本地存储都会带上目标项目）
        try {
          localStorage.setItem("mb.harness", h);
          localStorage.setItem("mb.projSel", p.id);
        } catch {}
        location.reload();
      }
    });
    return b;
  }));
}

document.getElementById("btn-overview")?.addEventListener("click", () => setOvMode(!ovMode));

/* ── 字体/字号：挪进面板（原属设置窗），写回 settings，3 秒轮询自动生效 ── */
const fontPop = document.getElementById("font-pop");
document.getElementById("btn-font")?.addEventListener("click", (e) => {
  e.stopPropagation();
  fontPop.hidden = !fontPop.hidden;
  if (!fontPop.hidden) {
    // 打开时同步当前生效值的高亮
    document.querySelectorAll("#font-pop .fp-opt").forEach((el) => {
      const on = el.dataset.font
        ? document.body.dataset.font === el.dataset.font
        : document.body.dataset.fontFamily === el.dataset.ff;
      el.classList.toggle("on", !!on);
    });
  }
});
document.querySelectorAll("#font-pop .fp-opt").forEach((el) =>
  el.addEventListener("click", async () => {
    const body = el.dataset.font ? { fontSize: el.dataset.font } : { fontFamily: el.dataset.ff };
    await jfetch("/api/prefs", body);
    document.querySelectorAll("#font-pop .fp-opt").forEach((x) =>
      x.classList.toggle("on", x.dataset.font === body.fontSize || x.dataset.ff === body.fontFamily));
  }));
document.addEventListener("mousedown", (e) => {
  if (fontPop && !fontPop.hidden && !e.target.closest("#font-pop, #btn-font")) fontPop.hidden = true;
});
document.getElementById("ov-dashboard")?.addEventListener("click", () =>
  window.bubbleBridge?.openDashboard());

/* ── 危险操作二次确认 ── */
let cfOpen = false, cfOk = null;
function showConfirm(title, text, onOk) {
  $("#cf-title").textContent = title;
  $("#cf-text").textContent = text;
  cfOpen = true; cfOk = onOk;
  $("#confirm-mask").hidden = false;
}
function closeConfirm() { cfOpen = false; cfOk = null; $("#confirm-mask").hidden = true; }
$("#cf-cancel")?.addEventListener("click", closeConfirm);
$("#cf-ok")?.addEventListener("click", async () => {
  const fn = cfOk;
  closeConfirm();
  if (fn) await fn();
});
$("#confirm-mask")?.addEventListener("click", (e) => { if (e.target.id === "confirm-mask") closeConfirm(); });
// Esc 优先级：确认框打开时只关确认框，不关面板（捕获阶段拦在 window.close 之前）
document.addEventListener("keydown", (e) => {
  if (cfOpen && e.key === "Escape") {
    e.stopImmediatePropagation();
    e.preventDefault();
    closeConfirm();
  }
}, true);

function confirmDeleteProject(p) {
  showConfirm("删除这块思维板？",
    `「${p.title || p.id}」连同全部目标与条目将被删除，且不可恢复。`, async () => {
      await jfetch("/api/action", { projectId: p.id, action: "delete" });
      await refreshAll();
      if (ovMode) renderOv();
    });
}

/* ── 要点预览：面板内 iframe 加载完整版（项目地图/图解页…） ── */
let pvOpen = false;
function showPreview(title, url) {
  $("#pv-title").textContent = title;
  $("#pv-frame").src = url;
  $("#preview-mask").hidden = false;
  pvOpen = true;
}
function closePreview() {
  pvOpen = false;
  $("#preview-mask").hidden = true;
  $("#pv-frame").src = "about:blank";   // 停掉预览页的轮询/动画
}
$("#pv-close")?.addEventListener("click", closePreview);
$("#pv-open")?.addEventListener("click", () => {
  const u = $("#pv-frame").src;
  if (u && u !== "about:blank") window.bubbleBridge?.openExternal(u);
});
document.addEventListener("keydown", (e) => {
  if (pvOpen && e.key === "Escape") {
    e.stopImmediatePropagation();   // 预览打开时 Esc 只关预览，不关面板
    e.preventDefault();
    closePreview();
  }
}, true);

async function refreshAll() {
  try {
    const ov = await jfetch("/api/overview");
    lastOv = ov;
    document.body.dataset.font = ov.settings?.fontSize || "m";
    document.body.dataset.fontFamily = ov.settings?.fontFamily || "georgia";
    document.body.dataset.theme = ov.settings?.panelTheme || "cream";
    I18N.setLang(ov.settings?.language === "en" ? "en" : "zh");
    I18N.apply(document);
    // 决定 harness 与默认项目
    const { list, name } = pickDefaultProject(ov);
    if (name && !harness) harness = name;
    // 一次性：跨窗口/仪表盘的项目选中意图（mb.projSel 用一次即清）+ URL ?project=
    if (!projSelDone && list.length) {
      projSelDone = true;
      let want = "";
      try {
        want = localStorage.getItem("mb.projSel") || "";
        localStorage.removeItem("mb.projSel");
      } catch {}
      if (!want) want = new URLSearchParams(location.search).get("project") || "";
      const hit = list.find((p) => p.id === want);
      if (hit) curProjectId = hit.id;
    }
    if (list.length && (!curProjectId || !list.some((p) => p.id === curProjectId))) {
      curProjectId = list[0].id;
    }
    renderProjTrigger(ov);
    if (!curProjectId) {
      const pn = document.getElementById("proj-name");
      if (pn && pn.tagName === "SPAN") pn.textContent = name ? (LABELS[name] || name) : "Mind Board";
      $("#goal-list").replaceChildren();
      for (const k of ["ideas","points","plans","gaps"]) {
        $(`#list-${k}`).replaceChildren();
        $(`#list-${k}`).appendChild(hintLi(I18N.t(HINT_KEYS[k])));
      }
      $("#pending-banner").hidden = true;
      return;
    }
    await loadSkeleton(true);
  } catch { /* 服务未就绪 */ }
}
refreshAll();
setInterval(refreshAll, 2500);
