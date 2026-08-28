// mind-board-pet — 数据中枢（core/store.mjs）
// 跨 harness 共享的思维板数据层。被三端复用：
//   · MCP server（各 harness 拉起）—— 直接 import 本模块读写
//   · HTTP 服务（Electron 主进程内嵌 / 独立浏览器模式）
//   · 冒烟测试
// 存储根目录：~/.mind-board/（MIND_BOARD_HOME 可覆盖，用于测试隔离）
//
// 设计要点：
//   · 所有写盘走「临时文件 + rename」原子替换，杜绝半文件
//   · 同层条目按文本相似度去重（精确或 Jaccard ≥ 0.7 视为同一条，做更新而非新增）
//   · 目标变化检测：新 goal 与现 goal 相似度过低且骨架非空 → 拒绝并置 pendingNewTask，
//     由 agent 先问用户（与原 dsh-mind-board 语义一致）
//   · 每次真实变更追加 journal.jsonl，兔壳据此驱动动效（竖耳等）

import { resolve, basename, join } from "node:path";
import { homedir } from "node:os";
import {
  mkdirSync, readFileSync, writeFileSync, existsSync,
  appendFileSync, rmSync, renameSync, readdirSync, statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

export const ROOT = process.env.MIND_BOARD_HOME || resolve(homedir(), ".mind-board");
const PROJECTS_DIR = join(ROOT, "projects");
const SKELETONS_DIR = join(ROOT, "skeletons");
const JOURNAL_PATH = join(ROOT, "journal.jsonl");
const SETTINGS_PATH = join(ROOT, "settings.json");

export const LAYERS = ["ideas", "points", "plans", "gaps"];
const LAYER_TEXT_KEY = { ideas: "text", points: "text", plans: "title", gaps: "text" };

/* ────────────────────────── 基础工具 ────────────────────────── */

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    let raw = readFileSync(path, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);   // 旧工具写盘可能带 BOM，直接 parse 会静默丢文件
    return JSON.parse(raw);
  } catch { return null; }
}

function writeJson(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now() % 100000}`;
  try {
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, path);
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}

/** 追加一行事件到 journal.jsonl（兔壳据此驱动动效，如竖耳提醒）。
 *  超过 1MB 时轮转成 journal.old，防止无限增长。 */
export function journalEvent(evt) {
  try {
    mkdirSync(ROOT, { recursive: true });
    try {
      if (statSync(JOURNAL_PATH).size > 1024 * 1024) renameSync(JOURNAL_PATH, resolve(JOURNAL_PATH, "../journal.old"));
    } catch {}
    appendFileSync(JOURNAL_PATH, JSON.stringify({ at: new Date().toISOString(), ...evt }) + "\n", "utf8");
  } catch {}
}

function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const now = () => new Date().toISOString();
const gid = () => "g" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

/** 字符 bigram Jaccard 相似度（沿用原插件的鲁棒思路，对中文友好） */
export function charJaccard(a, b) {
  a = String(a || "").trim(); b = String(b || "").trim();
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    if (s.length === 1) set.add(s);
    return set;
  };
  const ga = grams(a), gb = grams(b);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

const normText = (t) => String(t ?? "").trim().replace(/\s+/g, " ");

/* ────────────────────────── 初始化 ────────────────────────── */

let dirsReady = false;
function ensureDirs() {
  if (dirsReady) return;
  for (const dir of [PROJECTS_DIR, SKELETONS_DIR]) {
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
  dirsReady = true;
}
ensureDirs();

export function readSettings() {
  const s = readJson(SETTINGS_PATH) || {};
  const font = s.fontSize;
  const m = s.modules || {};
  return {
    mode: s.mode === "on" ? "on" : "off",
    windowPos: s.windowPos || null,
    tutorialDone: !!s.tutorialDone,
    petEdge: ["left", "right", "taskbar"].includes(s.petEdge) ? s.petEdge : "right",
    petPin: s.petPin !== false,
    autostart: !!s.autostart,
    fontSize: ["s", "m", "l"].includes(font) ? font : "m",
    organizeInterval: [1, 2, 3].includes(Number(s.organizeInterval)) ? Number(s.organizeInterval) : 2,
    fontFamily: ["georgia", "song", "sans", "kai", "hei"].includes(s.fontFamily) ? s.fontFamily : "georgia",
    skin: "cat",
    panelTheme: "cream",   // 优雅纸色为主题；深色变体保留在 CSS（data-theme="ink"）待 UI 开关
    language: s.language === "en" ? "en" : "zh",
    greetings: Array.isArray(s.greetings) && s.greetings.length && !s.greetings.some((g) => /德布劳内|阵型|中场|17 号/.test(g))
      ? s.greetings.slice(0, 12)
      : ["喵～小黑猫上线。", "闭眼是在想事，喵。", "缺口我会盯着的，喵。", "思维板已就位，喵。"],
    modules: {
      juggle: m.juggle !== false,
      autoJuggle: m.autoJuggle !== false,
      speech: m.speech !== false,
      tutorial: m.tutorial !== false,
      celebrate: m.celebrate !== false,
    },
  };
}

export function writeSettings(patch) {
  const prev = readJson(SETTINGS_PATH) || {};
  writeJson(SETTINGS_PATH, { ...prev, ...patch });
}

/* ────────────────────────── 项目解析 ────────────────────────── */

/** 由 cwd 解析出稳定的 projectId；不存在则建档。
 *  harness 出身戳记录在项目档案里，兔壳据此分组展示。 */
export function resolveProject(cwd, harness = "unknown") {
  ensureDirs();
  const dir = resolve(cwd || process.cwd());
  const key = process.platform === "win32" ? dir.toLowerCase() : dir;
  const id = "p" + hashId(key);
  const existing = readJson(join(PROJECTS_DIR, id + ".json"));
  if (existing) {
    // 目录还在且换成别的 harness 打开 → 只登记 harness 首见，不覆盖原始出身
    if (!existing.harnesses?.includes(harness)) {
      existing.harnesses = [...(existing.harnesses || []), harness];
      writeJson(join(PROJECTS_DIR, id + ".json"), existing);
      journalEvent({ type: "harness-join", projectId: id, harness });
    }
    return existing;
  }
  const rec = {
    id,
    title: basename(dir) || dir,
    projectDir: dir,
    harness,
    harnesses: [harness],
    state: "draft",
    createdAt: now(),
    updatedAt: now(),
    pendingNewTask: false,
    msgCounter: 0,
  };
  writeJson(join(PROJECTS_DIR, id + ".json"), rec);
  journalEvent({ type: "project-new", projectId: id, harness, title: rec.title });
  return rec;
}

function saveProject(rec) {
  rec.updatedAt = now();
  writeJson(join(PROJECTS_DIR, rec.id + ".json"), rec);
}

function loadProject(projectId) {
  const rec = readJson(join(PROJECTS_DIR, projectId + ".json"));
  return rec || null;
}

/* ────────────────────────── 骨架 ────────────────────────── */

function emptyGoal(title = "默认目标", goal = "") {
  return { id: gid(), title, goal, ideas: [], points: [], plans: [], gaps: [], createdAt: now() };
}

function skeletonPath(projectId) { return join(SKELETONS_DIR, projectId + ".json"); }

export function readSkeleton(projectId) {
  const raw = readJson(skeletonPath(projectId));
  if (!raw) return null;
  // 兼容旧单目标结构（原 dsh 插件迁移来的文件没有 goals 数组时兜底包一层）
  if (!Array.isArray(raw.goals)) {
    const g0 = emptyGoal(raw.title || "默认目标", typeof raw.goal === "string" ? raw.goal : "");
    for (const layer of LAYERS) g0[layer] = Array.isArray(raw[layer]) ? raw[layer] : [];
    return { goals: [g0], currentGoalId: g0.id };
  }
  const goals = raw.goals.map((g) => ({
    ...emptyGoal(g.title || "目标", typeof g.goal === "string" ? g.goal : ""),
    ...g,
  }));
  for (const g of goals) for (const l of LAYERS) if (!Array.isArray(g[l])) g[l] = [];
  const currentGoalId = goals.some((g) => g.id === raw.currentGoalId)
    ? raw.currentGoalId : (goals[0]?.id || null);
  return { goals, currentGoalId };
}

function writeSkeleton(projectId, sk) {
  writeJson(skeletonPath(projectId), sk);
}

function currentGoal(sk) {
  return sk.goals.find((g) => g.id === sk.currentGoalId) || sk.goals[0] || null;
}

/** 骨架是否已有实质内容（用于目标变化检测豁免空骨架） */
function hasContent(g) {
  if (!g) return false;
  if (String(g.goal || "").trim()) return true;
  return LAYERS.some((l) => (g[l] || []).length > 0);
}

function findById(list, id) { return list.find((x) => x.id === id); }

/* ────────────────────────── 整理（organize 核心） ────────────────────────── */

/**
 * 增量整理：把 agent 给出的各层条目合并进当前目标。
 * - 同层去重：文本规范化后精确相同 或 Jaccard ≥ 0.7 → 更新既有条目而非新增
 * - 计数返回 applied:{layer:added} 与 updated 数量，供 tool 回执与兔壳动效
 */
export function organize(projectId, payload = {}) {
  ensureDirs();
  const rec = loadProject(projectId);
  if (!rec) return { ok: false, message: `项目不存在: ${projectId}` };

  let sk = readSkeleton(projectId);
  if (!sk) {
    const first = emptyGoal(payload.goalTitle || "默认目标", payload.goalTitle ? "" : "");
    first.goal = payload.goal || payload.goalTitle || "";
    sk = { goals: [first], currentGoalId: first.id };
  }
  const goal = currentGoal(sk);
  if (!goal) return { ok: false, message: "骨架无当前目标" };

  /* 目标变化检测：只看显式给出的新 goal/goalTitle */
  const candidate = normText(payload.goal || payload.goalTitle || "");
  if (candidate && hasContent(goal)) {
    const currentText = normText(goal.goal || goal.title);
    const sim = charJaccard(candidate, currentText);
    if (sim < 0.25) {
      rec.pendingNewTask = true;
      saveProject(rec);
      journalEvent({ type: "goal-conflict", projectId, hint: candidate.slice(0, 24) });
      return {
        ok: false,
        pendingNewTask: true,
        similarity: Number(sim.toFixed(3)),
        message:
          "检测到疑似全新目标（与新项目判别相似度过低）。请先暂停整理，向用户确认：" +
          "『这看起来是一个新的目标/话题，需要新建一个思维板目标吗？』用户明确同意后，先调用 mind_board_control 的 new-goal 动作再继续整理。",
      };
    }
    rec.pendingNewTask = false;
  }

  const applied = {}; let gapAdded = false;

  const mergeList = (layer, incoming, decorate) => {
    if (!Array.isArray(incoming) || !incoming.length) return { added: 0, updated: 0 };
    let added = 0, updated = 0;
    for (const item of incoming) {
      if (!item || typeof item !== "object") continue;
      const text = normText(item.text ?? item.title);
      if (!text) continue;
      const bucket = goal[layer];
      const dup = bucket.find((b) => {
        const bt = normText(b[LAYER_TEXT_KEY[layer]]);
        if (!bt) return false;
        if (bt.toLowerCase() === text.toLowerCase()) return true;
        return charJaccard(bt, text) >= 0.7;
      });
      if (dup) {
        Object.assign(dup, decorate(item, dup));
        dup.at = now();
        updated++;
      } else {
        const fresh = decorate(item, null);
        fresh.id = layer[0].toUpperCase() + randomUUID().slice(0, 6);
        fresh.at = now();
        bucket.push(fresh);
        added++;
        if (layer === "gaps") gapAdded = true;
      }
    }
    return { added, updated };
  };

  const stats = {
    ideas: mergeList("ideas", payload.ideas, (it) => ({
      text: normText(it.text),
      group: it.group ? String(it.group).slice(0, 12) : undefined,
      done: !!it.done,
    })),
    points: mergeList("points", payload.points, (it) => ({
      text: normText(it.text),
      decided: !!it.decided,
    })),
    plans: mergeList("plans", payload.plans, (it) => {
      // 「当前采用」全局唯一：本轮采用谁，就先清掉所有旧采用
      if (!!it.chosen) for (const p of goal.plans) p.chosen = false;
      return {
        title: normText(it.title ?? it.text),
        chosen: !!it.chosen, dismissed: !!it.dismissed,
        paths: Array.isArray(it.paths) ? it.paths.map((p) => ({ step: String(p?.step ?? p ?? "").slice(0, 30) })).filter((p) => p.step) : [],
      };
    }),
    gaps: mergeList("gaps", payload.gaps, (it) => ({
      text: normText(it.text),
      resolved: !!it.resolved,
    })),
  };
  // 「当前采用」全局唯一由 mergeList 装饰器保证，这里不再后处理
  for (const [layer, s] of Object.entries(stats)) {
    if (s.added > 0) applied[layer] = s.added;
    if (s.updated > 0) applied[layer + "_updated"] = s.updated;
  }

  if (payload.goal) goal.goal = normText(payload.goal);
  if (payload.goalTitle) goal.title = normText(payload.goalTitle);

  const touched = Object.keys(applied).some((k) => applied[k] > 0) || candidate;
  if (touched) {
    writeSkeleton(projectId, sk);
    rec.state = "clarifying";
    saveProject(rec);
    journalEvent({
      type: "organized", projectId, harness: payload.harness || rec.harness,
      applied, gapAdded,
      brief: normText(goal.goal || goal.title).slice(0, 20),
    });
  }
  // 整理过就重新计轮（整理频率倒计时归零）
  rec.msgCounter = 0;
  saveProject(rec);

  return { ok: true, applied, projectId, currentGoalId: goal.id };
}

/**
 * 每轮对话打点：累加该项目的消息计数，返回是否到了该整理的轮次。
 * 供 UserPromptSubmit 钩子调用（只有钩子知道"又一轮过去了"）。
 */
export function tickMessage(projectDir) {
  ensureDirs();
  const dir = resolve(projectDir || process.cwd());
  const key = process.platform === "win32" ? dir.toLowerCase() : dir;
  const id = "p" + hashId(key);
  const rec = readJson(join(PROJECTS_DIR, id + ".json"));
  if (!rec) return null;
  const interval = readSettings().organizeInterval;
  rec.msgCounter = (rec.msgCounter || 0) + 1;
  writeJson(join(PROJECTS_DIR, id + ".json"), rec);
  return { counter: rec.msgCounter, interval, due: rec.msgCounter >= interval };
}

/**
 * 宿主动作（面板交互 → 写回）：切目标/新建目标/删除条目/勾选/采用方案/归档任务……
 * 全部以 action 分发，参数经 params 传入。返回 {ok, ...}。
 */
export function controlAction(projectId, { action, params = {} } = {}) {
  ensureDirs();
  const rec = loadProject(projectId);
  if (!rec) return { ok: false, message: "项目不存在" };
  if (action === "delete") {
    rmSync(skeletonPath(projectId), { force: true });
    rmSync(join(PROJECTS_DIR, projectId + ".json"), { force: true });
    journalEvent({ type: "task-deleted", projectId });
    return { ok: true };
  }
  const sk = readSkeleton(projectId);
  if (!sk && !["new-goal"].includes(action)) return { ok: false, message: "骨架为空" };
  const goal = sk ? currentGoal(sk) : null;

  switch (action) {
    case "new-goal": {
      const title = normText(params.title) || "新目标";
      const ng = emptyGoal(title, params.goal ? normText(params.goal) : "");
      if (!sk) { var created = { goals: [ng], currentGoalId: ng.id }; }
      else { sk.goals.push(ng); sk.currentGoalId = ng.id; }
      const target = created || sk;
      writeSkeleton(projectId, target);
      rec.pendingNewTask = false; rec.state = "draft"; saveProject(rec);
      journalEvent({ type: "goal-switched", projectId, to: ng.title });
      return { ok: true, goalId: ng.id };
    }
    case "switch-goal": {
      if (!findById(sk.goals, params.id)) return { ok: false, message: "目标不存在" };
      sk.currentGoalId = params.id; writeSkeleton(projectId, sk);
      journalEvent({ type: "goal-switched", projectId, to: findById(sk.goals, params.id).title });
      return { ok: true };
    }
    case "rename-goal": {
      const g = findById(sk.goals, params.id);
      if (!g) return { ok: false, message: "目标不存在" };
      const t = normText(params.title);
      if (!t) return { ok: false, message: "名称为空" };
      g.title = t; g.at = now();
      writeSkeleton(projectId, sk);
      return { ok: true };
    }
    case "remove-goal": {
      const g = findById(sk.goals, params.id);
      if (!g) return { ok: false, message: "目标不存在" };
      if (sk.goals.length <= 1) return { ok: false, message: "至少要留一个目标" };
      sk.goals = sk.goals.filter((x) => x.id !== params.id);
      if (sk.currentGoalId === params.id) sk.currentGoalId = sk.goals[0].id;   // 删掉当前目标 → 回落到第一个
      writeSkeleton(projectId, sk);
      journalEvent({ type: "goal-removed", projectId, title: g.title });
      return { ok: true };
    }
    case "remove-item": {
      if (!LAYERS.includes(params.layer)) return { ok: false, message: "未知层级" };
      goal[params.layer] = goal[params.layer].filter((x) => x.id !== params.id);
      writeSkeleton(projectId, sk); saveProject(rec);
      journalEvent({ type: "item-removed", projectId, layer: params.layer });
      return { ok: true };
    }
    case "toggle-point": {
      const it = findById(goal.points, params.id); if (!it) return { ok: false };
      it.decided = !it.decided; it.at = now();
      writeSkeleton(projectId, sk); return { ok: true };
    }
    case "toggle-done": {
      const it = findById(goal.ideas, params.id); if (!it) return { ok: false };
      it.done = !it.done; it.at = now();
      writeSkeleton(projectId, sk); return { ok: true };
    }
    case "toggle-gap": {
      const it = findById(goal.gaps, params.id); if (!it) return { ok: false };
      it.resolved = !it.resolved; it.at = now();
      writeSkeleton(projectId, sk); journalEvent({ type: "gap-toggled", projectId });
      return { ok: true };
    }
    case "choose-plan": {
      for (const p of goal.plans) p.chosen = p.id === params.id;
      const me = findById(goal.plans, params.id); if (me) { me.dismissed = false; me.at = now(); }
      writeSkeleton(projectId, sk); journalEvent({ type: "plan-chosen", projectId });
      return { ok: true };
    }
    case "dismiss-plan": {
      const p = findById(goal.plans, params.id); if (!p) return { ok: false };
      p.dismissed = !p.dismissed; p.chosen = false; p.at = now();
      writeSkeleton(projectId, sk); return { ok: true };
    }
    case "rename-project": {
      rec.title = normText(params.title) || rec.title; saveProject(rec); return { ok: true };
    }
    case "archive": {
      rec.state = "reflected"; saveProject(rec);
      journalEvent({ type: "archived", projectId }); return { ok: true };
    }
    case "reopen": {
      rec.state = "clarifying"; saveProject(rec); return { ok: true };
    }
    default:
      return { ok: false, message: `未知动作: ${action}` };
  }
}

/* ────────────────────────── 总览 / 查询 ────────────────────────── */

function summarize(projectId, rec) {
  const sk = readSkeleton(projectId);
  const goal = sk ? currentGoal(sk) : null;
  const count = (l, pred = () => true) => (goal ? goal[l].filter(pred).length : 0);
  return {
    id: projectId,
    title: rec.title,
    projectDir: rec.projectDir,
    state: rec.state,
    harnesses: rec.harnesses || [],
    pendingNewTask: !!rec.pendingNewTask,
    updatedAt: rec.updatedAt,
    currentGoal: goal ? goal.goal || goal.title : "",
    counts: goal ? {
      ideas: count("ideas", (i) => !i.done),
      doneIdeas: count("ideas", (i) => !!i.done),
      points: count("points"),
      decidedPoints: count("points", (p) => !!p.decided),
      plans: count("plans"),
      chosenPlan: count("plans", (p) => !!p.chosen),
      gaps: count("gaps", (g) => !g.resolved),
      resolvedGaps: count("gaps", (g) => !!g.resolved),
    } : { ideas: 0, doneIdeas: 0, points: 0, decidedPoints: 0, plans: 0, chosenPlan: 0, gaps: 0, resolvedGaps: 0 },
    updatedAtMs: Date.parse(rec.updatedAt || 0) || 0,
  };
}

/** 兔壳轮询的总览：按最近活跃排序的项目列表（客户端自行按 harness 分组） */
export function overview() {
  ensureDirs();
  const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  const ids = readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".json"));
  const items = [];
  for (const f of ids) {
    try {
      const rec = JSON.parse(readFileSync(join(PROJECTS_DIR, f), "utf8"));
      if (rec?.id) {
        // liveAtMs = 项目档案/骨架的文件 mtime：钩子每轮 tick、MCP 每次整理都会写盘，
        // 所以它能真实反映「这个 harness 此刻是否在跑」，而非历史的 updatedAt 字段
        const liveAtMs = Math.max(mtime(join(PROJECTS_DIR, f)), mtime(skeletonPath(rec.id)));
        items.push({ ...summarize(rec.id, rec), liveAtMs });
      }
    } catch {}
  }
  items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  // 30 天未动的项目标记 idle，图标条不再显示（数据保留，可导出找回）
  const THIRTY_DAYS = 30 * 24 * 3600 * 1000;
  for (const it of items) it.active = (Date.now() - it.updatedAtMs) < THIRTY_DAYS;
  return { settings: readSettings(), projects: items, journalSize: journalTailIndex(), server: "mind-board-pet" };
}

let lastJournalSize = 0;
function journalTailIndex() {
  try {
    const s = statSync(JOURNAL_PATH);
    lastJournalSize = s.size;
    return s.size;
  } catch { return 0; }
}

export function journalTail(after = 0) {
  try {
    if (!existsSync(JOURNAL_PATH)) return { size: 0, events: [] };
    const buf = readFileSync(JOURNAL_PATH, "utf8");
    const lines = buf.split("\n").filter(Boolean);
    const size = Buffer.byteLength(buf, "utf8");
    const events = [];
    let pos = 0;
    for (const line of lines) {
      const len = Buffer.byteLength(line + "\n", "utf8");
      if (pos >= after) { try { events.push(JSON.parse(line)); } catch {} }
      pos += len;
    }
    return { size, events };
  } catch { return { size: 0, events: [] }; }
}

export function fullSkeleton(projectId) {
  const rec = loadProject(projectId);
  if (!rec) return null;
  const sk = readSkeleton(projectId);
  return { summary: summarize(projectId, rec), skeleton: sk };
}

/** 给 agent 看的紧凑文本视图 */
export function queryMarkdown(cwd, harness = "unknown") {
  const rec = resolveProject(cwd, harness);
  const s = summarize(rec.id, rec);
  const sk = readSkeleton(rec.id);
  const g = sk ? currentGoal(sk) : null;
  const sec = (l, label, fmt) =>
    g && g[l].length ? `\n${label}（${g[l].length}）：\n` + g[l].map(fmt).join("\n") : "";
  const md =
    `【思维板】${s.title}\n` +
    `目标：${s.currentGoal || "（未定）"}\n状态：${s.state}｜未想清缺口 ${s.counts.gaps}` +
    sec("ideas", "想法", (i) => `- ${i.text}${i.group ? `（组:${i.group}）` : ""}${i.done ? " ✅已实现" : ""}`) +
    sec("points", "要点", (p) => `- ${p.text}${p.decided ? " ✔已定" : ""}`) +
    sec("plans", "方案", (p) => `- ${p.title}${p.chosen ? "【当前采用】" : p.dismissed ? "【已否决】" : ""}`) +
    sec("gaps", "缺口", (x) => `- ${x.text}${x.resolved ? "（已解决）" : ""}`);
  return { markdown: md, summary: s };
}

/* ────────────────────────── 导出 / 导入 ────────────────────────── */

export function exportAll() {
  const out = { version: 1, exportedAt: now(), tasks: {} };
  for (const f of readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".json"))) {
    try {
      const rec = JSON.parse(readFileSync(join(PROJECTS_DIR, f), "utf8"));
      out.tasks[rec.id] = { task: rec, skeleton: readSkeleton(rec.id) };
    } catch {}
  }
  return out;
}

export function importAll(data, opts = {}) {
  if (!data || data.version !== 1 || !data.tasks) return { ok: false, message: "格式不符" };
  const from = opts.from || "import";   // 导入来源标记：让 harness 分组有归属（这批数据多半来自 dsh 插件）
  let n = 0;
  for (const [oldId, item] of Object.entries(data.tasks)) {
    // 新 id 防冲突
    const nid = existsSync(join(PROJECTS_DIR, oldId + ".json"))
      ? "p" + randomUUID().slice(0, 8) : oldId;
    const rec = { ...item.task, id: nid };
    // 老数据没有 harnesses：补上来源 + harness 兜底（否则全进 "other"，图标坞被 42 枚爪印淹没）
    if (!Array.isArray(rec.harnesses) || !rec.harnesses.length) {
      rec.harness = rec.harness && rec.harness !== "unknown" ? rec.harness : from;
      rec.harnesses = [rec.harness];
    }
    writeJson(join(PROJECTS_DIR, nid + ".json"), rec);
    if (item.skeleton) writeJson(skeletonPath(nid), item.skeleton);
    n++;
  }
  journalEvent({ type: "imported", count: n });
  return { ok: true, imported: n };
}
