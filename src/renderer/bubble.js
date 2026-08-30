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

/* ── 图钉：常显不自动收起（状态存 localStorage，重启保持） ──
   线条 SVG 图钉：未钉=灰色倾斜45°（没插上）；已钉=琥珀实心正立（插住了） */
const pinBtn = $("#btn-pin");
let pinned = true;   // 默认钉住：面板不因点击别处消失，想常显/收起用图钉显式切换
try { pinned = localStorage.getItem("mb.pinned") !== "0"; } catch {}

const PIN_SVG = (filled) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

function applyPin() {
  pinBtn.classList.toggle("on", pinned);
  pinBtn.innerHTML = PIN_SVG(pinned);
  pinBtn.title = pinned ? "已钉住：点此取消常显" : "钉住：常显不自动收起";
  window.bubbleBridge?.setPinned(pinned);
}
pinBtn.addEventListener("click", () => {
  pinned = !pinned;
  try { localStorage.setItem("mb.pinned", pinned ? "1" : "0"); } catch {}
  applyPin();
});
applyPin();

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

/* ── 项目选择：顶部标题即触发器；点名字改名，点其余处/箭头展开下拉 ── */
let projList = [];
const projTrigger = $("#proj-trigger");
const projMenu = $("#proj-menu");

function renderProjMenu() {
  projMenu.replaceChildren();
  if (!projList.length) return;
  for (const p of projList) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "proj-item" + (p.id === curProjectId ? " on" : "");
    b.title = `${p.projectDir}\n想法 ${p.counts.ideas}・缺口 ${p.counts.gaps}`;
    const nm = document.createElement("span");
    nm.className = "proj-item-name";
    nm.textContent = p.title;
    b.appendChild(nm);
    b.addEventListener("click", () => {
      projMenu.hidden = true;
      if (p.id !== curProjectId) selectProject(p.id);
    });
    projMenu.appendChild(b);
  }
}

function renderProjTrigger(ov) {
  projList = pickDefaultProject(ov).list;
  const cur = projList.find((p) => p.id === curProjectId);
  $("#proj-name").textContent = cur?.title || (projList[0]?.title || "思维板");
  renderProjMenu();
}

/* 触发器：点名字 → 改名；点其他（含箭头）→ 展开/收起菜单 */
projTrigger.addEventListener("click", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.target.closest("#proj-name")) {
    if (curProjectId) startRenameProject();
    return;
  }
  projMenu.hidden = !projMenu.hidden;
});
document.addEventListener("click", (e) => {
  if (!projMenu.hidden && !e.target.closest("#proj-select")) projMenu.hidden = true;
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

/* 像素 HP 血条：已敲定要点 / 全部要点 */
function renderHp(c) {
  const bar = $("#hp-bar");
  const total = (c.points || 0);
  const decided = (c.decidedPoints || 0);
  const segs = 10;
  let fill = total > 0 ? Math.round((decided / total) * segs) : 0;
  bar.replaceChildren();
  for (let i = 0; i < segs; i++) {
    const cell = document.createElement("i");
    if (i < fill) cell.className = "f";
    bar.appendChild(cell);
  }
  bar.classList.toggle("low", total > 0 && fill <= segs * 0.3);
  $("#hp-text").textContent = total > 0
    ? `${decided}/${total}`
    : "NO DATA";
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
  li.appendChild(mkSpan("li-mark", it.done ? "●" : "○"));
  li.appendChild(mkSpan("li-text", it.text));
  li.appendChild(mkDel("ideas", it.id));
  li.addEventListener("click", async () => {
    await jfetch("/api/action", { projectId: curProjectId, action: "toggle-done", params: { id: it.id } });
    loadSkeleton(true);
  });
  bindItemDrag(li, { layer: "ideas", id: it.id }, it.text, { canToggle: true });   // 想法可拖到绿区标记已实现
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
function mkDel(layer, id) {
  const b = document.createElement("button");
  b.className = "li-del"; b.textContent = "×";
  b.title = "删除";
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    await jfetch("/api/action", { projectId: curProjectId, action: "remove-item", params: { layer, id } });
    loadSkeleton(true);
  });
  return b;
}
function hintLi(text) {
  const li = document.createElement("li");
  li.className = "empty-hint-row";
  const d = document.createElement("div");
  d.className = "empty-hint"; d.textContent = text;
  li.appendChild(d);
  return li;
}

const HINT_KEYS = {
  ideas: "hint.ideas", points: "hint.points", plans: "hint.plans", gaps: "hint.gaps",
};

function renderLayer(listEl, kind, goal) {
  listEl.replaceChildren();
  const arr = goal[kind] || [];
  if (!arr.length) { listEl.appendChild(hintLi(I18N.t(HINT_KEYS[kind]))); return; }

  if (kind === "ideas") {
    const openArr = arr.filter((it) => !it.done);
    const doneArr = arr.filter((it) => it.done);
    // 【动态分组】未实现想法按 group 归类；无 group 的单独平铺
    const groups = {};
    const standalone = [];
    for (const it of openArr) {
      const g = it.group;
      if (g) (groups[g] = groups[g] || []).push(it);
      else standalone.push(it);
    }
    const redraw = () => renderLayers(curSkeleton);
    for (const [gname, items] of Object.entries(groups)) {
      const key = "ideas:" + gname;
      const isOpen = !!expGroup[key];
      listEl.appendChild(mkGroupHead(gname, items.length + " 条", isOpen, "", () => {
        expGroup[key] = !isOpen;
        redraw();
      }));
      if (isOpen) for (const it of items) listEl.appendChild(mkIdeaLi(it));
    }
    for (const it of standalone) listEl.appendChild(mkIdeaLi(it));
    // 已实现：收进折叠区
    if (doneArr.length) {
      const key = "ideas:__done";
      const isOpen = !!expGroup[key];
      listEl.appendChild(mkGroupHead("已实现", doneArr.length + " 条", isOpen, "grp-done", () => {
        expGroup[key] = !isOpen;
        redraw();
      }));
      if (isOpen) for (const it of doneArr) listEl.appendChild(mkIdeaLi(it));
    }
  } else if (kind === "points") {
    for (const it of arr) {
      const li = mkLi(it.decided ? "pt-decided" : "pt-open", { layer: "points", id: it.id });
      li.appendChild(mkSpan("li-mark", it.decided ? "✔" : "▸"));
      li.appendChild(mkSpan("li-text", it.text));
      li.appendChild(mkDel("points", it.id));
      li.addEventListener("click", async () => {
        await jfetch("/api/action", { projectId: curProjectId, action: "toggle-point", params: { id: it.id } });
        loadSkeleton(true);
      });
      bindItemDrag(li, { layer: "points", id: it.id }, it.text);
      listEl.appendChild(li);
    }
  } else if (kind === "plans") {
    let num = 0;
    for (const it of arr) {
      num++;
      const li = mkLi("pl-row", { layer: "plans", id: it.id });
      const head = document.createElement("div"); head.className = "pl-head";
      head.appendChild(mkSpan("li-mark", String(num)));
      head.appendChild(mkSpan("li-text", it.title));
      head.appendChild(mkDel("plans", it.id));
      const ops = document.createElement("div"); ops.className = "pl-ops";
      const bChosen = document.createElement("button");
      bChosen.className = "pl-btn" + (it.chosen ? " chosen" : "");
      bChosen.textContent = it.chosen ? I18N.t("plan.adopted") : I18N.t("plan.adopt");
      bChosen.disabled = !!it.chosen;
      bChosen.addEventListener("click", async (e) => {
        e.stopPropagation();
        await jfetch("/api/action", { projectId: curProjectId, action: "choose-plan", params: { id: it.id } });
        loadSkeleton(true);
      });
      const bDis = document.createElement("button");
      bDis.className = "pl-btn" + (it.dismissed ? " dismissed" : "");
      bDis.textContent = it.dismissed ? I18N.t("plan.dismissed") : I18N.t("plan.dismiss");
      bDis.addEventListener("click", async (e) => {
        e.stopPropagation();
        await jfetch("/api/action", { projectId: curProjectId, action: "dismiss-plan", params: { id: it.id } });
        loadSkeleton(true);
      });
      ops.append(bChosen, bDis);
      head.appendChild(ops);
      li.appendChild(head);
      for (const p of it.paths || []) {
        const pd = mkSpan("pl-path", "· " + (p.step || ""));
        li.appendChild(pd);
      }
      bindItemDrag(li, { layer: "plans", id: it.id }, it.title);
      listEl.appendChild(li);
    }
  } else if (kind === "gaps") {
    for (const it of arr) {
      const li = mkLi(it.resolved ? "gp-resolved" : "", { layer: "gaps", id: it.id });
      const dot = document.createElement("i");
      dot.className = "gp-dot";
      li.appendChild(dot);
      li.appendChild(mkSpan("li-text", it.text));
      li.appendChild(mkDel("gaps", it.id));
      li.addEventListener("click", async () => {
        await jfetch("/api/action", { projectId: curProjectId, action: "toggle-gap", params: { id: it.id } });
        loadSkeleton(true);
      });
      bindItemDrag(li, { layer: "gaps", id: it.id }, it.text);
      listEl.appendChild(li);
    }
  }
}

function renderLayers(sk) {
  const goal = goalOf(sk);
  const c = curSummary?.counts || {};
  renderHp(c);
  $("#c-ideas").textContent = c.ideas != null ? `${c.ideas + (c.doneIdeas||0)}${I18N.t("unit.items")}` : "";
  $("#c-points").textContent = c.points ? `${c.points}${I18N.t("unit.items")}` : "";
  $("#c-plans").textContent = c.plans ? `${c.plans}${I18N.t("unit.plans")}` : "";
  $("#c-gaps").textContent = c.gaps ? `${c.gaps}${I18N.t("gaps.todo")}` : I18N.t("gaps.clear");
  if (!goal) return;
  renderGoalList(sk);
  renderLayer($("#list-ideas"), "ideas", goal);
  renderLayer($("#list-points"), "points", goal);
  renderLayer($("#list-plans"), "plans", goal);
  renderLayer($("#list-gaps"), "gaps", goal);
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
  const zone = zoneAt(e);
  endDrag();
  if (!zone) return;
  if (zone === "del") {
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
  const list = [...(lastOv.projects || [])].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  box.replaceChildren(...list.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ov-item" + (p.id === curProjectId ? " on" : "");
    const c = p.counts || {};
    const stateTxt = { draft: "构思", clarifying: "推进", reflected: "已沉淀" }[p.state] || p.state;
    const meta = document.createElement("span");
    meta.className = "ov-meta";
    meta.innerHTML = `${c.gaps ? `<b>缺口 ${c.gaps}</b> · ` : ""}${stateTxt}`;
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
    b.addEventListener("click", () => {
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
document.getElementById("ov-dashboard")?.addEventListener("click", () =>
  window.bubbleBridge?.openDashboard());

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
