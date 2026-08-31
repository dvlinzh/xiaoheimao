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
  mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync,
  appendFileSync, rmSync, renameSync, readdirSync, statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

export const ROOT = process.env.MIND_BOARD_HOME || resolve(homedir(), ".mind-board");
const PROJECTS_DIR = join(ROOT, "projects");
const SKELETONS_DIR = join(ROOT, "skeletons");
const JOURNAL_PATH = join(ROOT, "journal.jsonl");
const SETTINGS_PATH = join(ROOT, "settings.json");

/* ────────────────────────── 三维九模块骨架（替代旧四层 ideas/points/plans/gaps） ──────────────────────────
 * 模块清单与条数建议见 docs/understanding-framework.html「记录骨架」节。
 * 旧四层数据读入时自动迁移（备份 .legacy.json 留证），字段映射：
 *   ideas→需求锚点  points→反馈闭环  plans→功能拆解(chosen→骨架识别)  gaps→依赖与瓶颈 */
export const DIMS = {
  why: {
    label: "价值维", color: "teal",
    modules: {
      anchor:      { label: "需求锚点", range: [1, 2], textKey: "text" },
      audience:    { label: "受众画像", range: [1, 1], textKey: "text" },
      proposition: { label: "价值主张", range: [1, 1], textKey: "text" },
    },
  },
  what: {
    label: "结构维", color: "violet",
    modules: {
      modules:    { label: "功能拆解", range: [3, 7], textKey: "title" },
      skeleton:   { label: "骨架识别", range: [2, 4], textKey: "title" },
      boundaries: { label: "边界定义", range: [2, 3], textKey: "text" },
    },
  },
  how: {
    label: "路径维", color: "amber",
    modules: {
      link:        { label: "核心链路", range: [3, 5], textKey: "text" },
      bottlenecks: { label: "依赖与瓶颈", range: [1, 3], textKey: "text" },
      feedback:    { label: "反馈闭环", range: [1, 2], textKey: "text" },
    },
  },
};
/** 全部模块键的扁平列表（顺序即面板渲染顺序） */
export const MODULES = Object.entries(DIMS).flatMap(([dim, d]) =>
  Object.entries(d.modules).map(([mod, m]) => ({ dim, mod, ...m })));
const MODULE_SET = new Set(MODULES.map((m) => m.mod));

/** 空九模块桶 */
function emptyDims() {
  const dims = {};
  for (const [dim, d] of Object.entries(DIMS)) {
    dims[dim] = {};
    for (const mod of Object.keys(d.modules)) dims[dim][mod] = [];
  }
  return dims;
}

/** 旧四层条目 → 九模块的迁移映射（读入时执行一次，原文件备份） */
const LEGACY_MAP = [
  ["ideas",  "why",  "anchor"],
  ["points", "how",  "feedback"],
  ["plans",  "what", "modules"],
  ["gaps",   "how",  "bottlenecks"],
];
const TEXT_KEY_FALLBACK = { modules: "title", skeleton: "title" };   // plans 旧文本键是 title


/** 项目/任务 id 白名单：p<hash>（目录项目）或 t_<ts>_<rand>（DSH 会话任务）。
 *  一切外部传入的 id 都先过这道闸——拒绝含路径语义的 id，
 *  防 /api/import、/api/action 等入口穿越出数据目录删写任意文件。 */
const ID_RE = /^(p[a-z0-9]{2,20}|t_[a-z0-9]{2,20}(_[a-z0-9]{2,12})?)$/;
export function isValidId(id) { return typeof id === "string" && ID_RE.test(id); }

/** 目录内安全拼接：id 不合法返回 null（调用方按"不存在"处理，绝不拼接穿透路径） */
function safeJoin(dir, id) {
  if (!isValidId(id)) return null;
  const p = join(dir, id + ".json");
  return p.startsWith(dir) ? p : null;   // 双保险
}

/* ────────────────────────── 基础工具 ────────────────────────── */

function readJson(path) {
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    let raw = readFileSync(path, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);   // 旧工具写盘可能带 BOM，直接 parse 会静默丢文件
    return JSON.parse(raw);
  } catch (e) {
    // 文件存在但解析失败（写坏/截断）：先备份留证再当空值——否则上游会拿新数据
    // 把可能只剩半个字节问题的文件直接盖掉，连抢救机会都没有。
    if (e instanceof SyntaxError) {
      try {
        const bak = `${path}.corrupt-${Date.now()}`;
        copyFileSync(path, bak);
        journalEvent({ type: "json-corrupt", path: basename(path), backup: basename(bak) });
      } catch {}
    }
    return null;
  }
}

function writeJson(path, data) {
  if (!path) return false;   // id 未过白名单：宁可不写，也不拼穿透路径
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
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

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
  const ui = s.ui || {};   // 图标环/桌宠运行参数（ring-calibrator 实时写入）
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
    // 图标环/桌宠运行参数（标定工具 ring-calibrator 实时写入，缺省走代码默认）
    ui: (() => {
      const u = s.ui || {};
      const d = u.dock || {}, p = u.pet || {};
      return {
        dock: {
          cx: num(d.cx, 95),      // 窗内圆心 X（petY/petX 坐标系）
          cy: num(d.cy, 95),      // 窗内圆心 Y
          r: num(d.r, 75),
          span: num(d.span, 120),
          start: num(d.start, -90),
          liveMs: num(d.liveMs, 600000),
        },
        pet: {
          bury: num(p.bury, 13),
          dragThresh: num(p.dragThresh, 10),
        },
      };
    })(),
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
  const existing = readJson(projectPath(id));
  if (existing) {
    // 目录还在且换成别的 harness 打开 → 只登记 harness 首见，不覆盖原始出身
    if (!existing.harnesses?.includes(harness)) {
      existing.harnesses = [...(existing.harnesses || []), harness];
      writeJson(projectPath(id), existing);
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
  writeJson(projectPath(id), rec);
  journalEvent({ type: "project-new", projectId: id, harness, title: rec.title });
  return rec;
}

function projectPath(id) { return safeJoin(PROJECTS_DIR, id); }

function saveProject(rec) {
  rec.updatedAt = now();
  return writeJson(projectPath(rec.id), rec);
}

function loadProject(projectId) {
  const rec = readJson(projectPath(projectId));
  return rec || null;
}

/* ────────────────────────── DSH 会话任务（多入口：DSH Cordis 壳专用） ────────────────────────── */

/** 按显式 id 建立一条会话任务记录（DSH 的 t_xxx；不推导 cwd）。
 *  与 resolveProject 的区别：服务「话题归属由会话/任务决定」的 harness（DSH），
 *  而非「项目归属由目录决定」的 harness（如 Claude Code）。数据结构同构，互不冲突。 */
export function createSessionRecord(id, init = {}) {
  ensureDirs();
  if (!isValidId(id)) return null;
  if (readJson(projectPath(id))) return { id, existing: true };
  const rec = {
    id,
    title: normText(init.title || "新任务"),
    sessionId: init.sessionId || null,
    harness: init.harness || "dsh",
    harnesses: [init.harness || "dsh"],
    state: "draft",
    createdAt: now(),
    updatedAt: now(),
    pendingNewTask: false,
    msgCounter: 0,
    ...init.extra,
  };
  writeJson(projectPath(id), rec);
  journalEvent({ type: "project-new", projectId: id, harness: rec.harness, title: rec.title });
  return rec;
}

/** 读-改-写一条项目记录（DSH 壳更新计数器/状态位用；原子写盘） */
export function touchRecord(id, patch) {
  const rec = loadProject(id);
  if (!rec) return null;
  Object.assign(rec, patch || {});
  rec.updatedAt = now();
  writeJson(projectPath(id), rec);
  return rec;
}

/** 全部项目记录（含 sessionId 等原始字段；DSH 壳按会话查任务用） */
export function allRecords() {
  ensureDirs();
  const out = [];
  for (const f of readdirSync(PROJECTS_DIR).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse(readFileSync(join(PROJECTS_DIR, f), "utf8"));
      if (rec?.id) out.push(rec);
    } catch {}
  }
  return out;
}

/* ────────────────────────── 骨架 ────────────────────────── */

function emptyGoal(title = "默认目标", goal = "") {
  return { id: gid(), title, goal, dims: emptyDims(), createdAt: now() };
}

function skeletonPath(projectId) { return safeJoin(SKELETONS_DIR, projectId); }

/** 旧四层骨架 → 新九模块的迁移（幂等：已含 dims 的目标原样保留） */
function migrateGoal(g) {
  // 判定"已是新结构"：dims 存在【且】不再带旧四层键。
  // （readSkeleton 的 spread {...emptyGoal(), ...g} 会把空 dims 和旧四层混在一起，
  //  只看 dims 有桶数组会误判成已迁移——旧数据从来没被搬进来。）
  const stillLegacy = ["ideas", "points", "plans", "gaps"].some((k) => Array.isArray(g[k]));
  if (g?.dims && typeof g.dims === "object" && !stillLegacy) {
    // 已是新结构：补齐缺的模块桶即可
    const d = emptyDims();
    for (const [dim, dd] of Object.entries(DIMS)) {
      for (const mod of Object.keys(dd.modules)) {
        d[dim][mod] = Array.isArray(g.dims[dim]?.[mod]) ? g.dims[dim][mod] : [];
      }
    }
    g.dims = d;
    return g;
  }
  // 旧四层：映射迁移（plans.chosen=true 的进骨架识别，其余进功能拆解）
  const dims = emptyDims();
  for (const [layer, dim, mod] of LEGACY_MAP) {
    const items = Array.isArray(g[layer]) ? g[layer] : [];
    for (const it of items) {
      const text = normText(it.text ?? it.title);
      if (!text) continue;
      const entry = { id: it.id || mod[0].toUpperCase() + randomUUID().slice(0, 6), at: it.at || now() };
      entry[DIMS[dim].modules[mod].textKey] = text;
      dims[dim][mod].push(entry);
      // chosen 方案同时登记进骨架识别（它本就是"被押注的架构决策"）
      if (layer === "plans" && it.chosen) {
        const e2 = { ...entry, id: "S" + randomUUID().slice(0, 6) };
        dims.what.skeleton.push(e2);
      }
    }
  }
  delete g.ideas; delete g.points; delete g.plans; delete g.gaps;
  g.dims = dims;
  return g;
}

export function readSkeleton(projectId) {
  const path = skeletonPath(projectId);
  const raw = readJson(path);
  if (!raw) return null;
  let migrated = false;
  let out;
  if (!Array.isArray(raw.goals)) {
    // 兼容最旧单目标结构
    const g0 = emptyGoal(raw.title || "默认目标", typeof raw.goal === "string" ? raw.goal : "");
    for (const layer of LEGACY_MAP.map((m) => m[0])) {
      g0[layer] = Array.isArray(raw[layer]) ? raw[layer] : [];
    }
    migrateGoal(g0); migrated = true;
    out = { goals: [g0], currentGoalId: g0.id };
  } else {
    const goals = raw.goals.map((g) => {
      const base = { ...emptyGoal(g.title || "目标", typeof g.goal === "string" ? g.goal : ""), ...g };
      if (migrateGoal(base) !== base || !Array.isArray(base.dims?.why?.anchor)) migrated = true;
      return base;
    });
    const currentGoalId = goals.some((g) => g.id === raw.currentGoalId)
      ? raw.currentGoalId : (goals[0]?.id || null);
    out = { goals, currentGoalId };
  }
  // 迁移过就留备份并写回新结构（备份只建一次，防循环覆盖）
  if (migrated && path && existsSync(path)) {
    try {
      const bak = path.replace(/\.json$/, ".legacy.json");
      if (!existsSync(bak)) copyFileSync(path, bak);
    } catch {}
    writeJson(path, out);
  }
  return out;
}

function writeSkeleton(projectId, sk) {
  return writeJson(skeletonPath(projectId), sk);
}

function currentGoal(sk) {
  return sk.goals.find((g) => g.id === sk.currentGoalId) || sk.goals[0] || null;
}

/** 骨架是否已有实质内容（用于目标变化检测豁免空骨架） */
function hasContent(g) {
  if (!g) return false;
  if (String(g.goal || "").trim()) return true;
  if (!g.dims) return false;
  for (const dd of Object.values(g.dims))
    for (const arr of Object.values(dd))
      if (Array.isArray(arr) && arr.length > 0) return true;
  return false;
}

function findById(list, id) { return list.find((x) => x.id === id); }
/** 按模块取目标下的桶 */
function bucketOf(goal, mod) { return goal.dims?.[moduleDim(mod)]?.[mod]; }
function moduleDim(mod) {
  for (const [dim, d] of Object.entries(DIMS)) if (d.modules[mod]) return dim;
  return null;
}

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

  const applied = {};

  /** 合并一个模块的条目：去重（精确/Jaccard≥0.7）→ 更新；否则新增 */
  const mergeList = (dim, mod, incoming, decorate) => {
    if (!Array.isArray(incoming) || !incoming.length) return { added: 0, updated: 0 };
    const m = DIMS[dim]?.modules?.[mod];
    if (!m) return { added: 0, updated: 0 };
    let added = 0, updated = 0;
    for (const item of incoming) {
      if (!item || typeof item !== "object") continue;
      const text = normText(item[m.textKey] ?? item.text ?? item.title);
      if (!text) continue;
      const bucket = goal.dims[dim][mod];
      const dup = bucket.find((b) => {
        const bt = normText(b[m.textKey]);
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
        fresh.id = mod[0].toUpperCase() + randomUUID().slice(0, 6);
        fresh.at = now();
        bucket.push(fresh);
        added++;
      }
    }
    return { added, updated };
  };

  const stats = {
    anchor:      mergeList("why", "anchor",      payload.anchor,      (it) => ({ text: normText(it.text ?? it.title), raw: it.raw ? String(it.raw).slice(0, 200) : undefined })),
    audience:    mergeList("why", "audience",    payload.audience,    (it) => ({ text: normText(it.text ?? it.title) })),
    proposition: mergeList("why", "proposition", payload.proposition, (it) => ({ text: normText(it.text ?? it.title) })),
    modules:     mergeList("what", "modules",    payload.modules,     (it) => ({ title: normText(it.title ?? it.text), paths: Array.isArray(it.paths) ? it.paths.map((p) => ({ step: String(p?.step ?? p ?? "").slice(0, 30) })).filter((p) => p.step) : [] })),
    skeleton:    mergeList("what", "skeleton",   payload.skeleton,    (it) => ({ title: normText(it.title ?? it.text) })),
    boundaries:  mergeList("what", "boundaries", payload.boundaries,  (it) => ({ text: normText(it.text ?? it.title) })),
    link:        mergeList("how",  "link",       payload.link,        (it) => ({ text: normText(it.text ?? it.step ?? it.title) })),
    bottlenecks: mergeList("how",  "bottlenecks",payload.bottlenecks, (it) => ({ text: normText(it.text ?? it.title) })),
    feedback:    mergeList("how",  "feedback",   payload.feedback,    (it) => ({ text: normText(it.text ?? it.title) })),
  };
  for (const [mod, s] of Object.entries(stats)) {
    if (s.added > 0) applied[mod] = s.added;
    if (s.updated > 0) applied[mod + "_updated"] = s.updated;
  }

  /* 旧 supersede 机制移除：九模块模型里"同结论再写"由维度内去重自动收敛，
   * 真正的替代靠新结论覆盖（mergeList 的更新路径） */

  if (payload.goal) goal.goal = normText(payload.goal);
  if (payload.goalTitle) goal.title = normText(payload.goalTitle);

  const touched = Object.keys(applied).some((k) => applied[k] > 0) || candidate;
  if (touched) {
    // 写盘失败不得假报 ok——否则调用方（AI/面板）以为已记入，实际磁盘没变
    if (!writeSkeleton(projectId, sk)) return { ok: false, message: "骨架写盘失败（磁盘不可写？）" };
    rec.state = "clarifying";
    saveProject(rec);
    journalEvent({
      type: "organized", projectId, harness: payload.harness || rec.harness,
      applied,
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
  const rec = readJson(projectPath(id));
  if (!rec) return null;
  const interval = readSettings().organizeInterval;
  rec.msgCounter = (rec.msgCounter || 0) + 1;
  writeJson(projectPath(id), rec);
  return { counter: rec.msgCounter, interval, due: rec.msgCounter >= interval };
}

/**
 * 宿主动作（面板交互 → 写回）：切目标/新建目标/删除条目/勾选/采用方案/归档任务……
 * 全部以 action 分发，参数经 params 传入。返回 {ok, ...}。
 */
export function controlAction(projectId, { action, params = {} } = {}) {
  ensureDirs();
  const rec = loadProject(projectId);   // id 过不了白名单时 loadProject 返回 null，天然挡掉穿透
  if (!rec) return { ok: false, message: "项目不存在" };
  if (action === "delete") {
    try {
      const sp = skeletonPath(projectId), pp = projectPath(projectId);
      if (sp) rmSync(sp, { force: true });
      if (pp) rmSync(pp, { force: true });
    } catch (e) { return { ok: false, message: "删除失败: " + String(e?.message || e) }; }
    journalEvent({ type: "task-deleted", projectId });
    return { ok: true };
  }
  const sk = readSkeleton(projectId);
  if (!sk && !["new-goal"].includes(action)) return { ok: false, message: "骨架为空" };
  const goal = sk ? currentGoal(sk) : null;
  // 写盘失败上抛为错误返回，不假装成功
  const saveSk = (target) => (writeSkeleton(projectId, target) ? null : { ok: false, message: "骨架写盘失败（磁盘不可写？）" });

  switch (action) {
    case "new-goal": {
      const title = normText(params.title) || "新目标";
      const ng = emptyGoal(title, params.goal ? normText(params.goal) : "");
      const target = sk || { goals: [ng], currentGoalId: ng.id };
      if (sk) { sk.goals.push(ng); sk.currentGoalId = ng.id; }
      const werr = saveSk(target); if (werr) return werr;
      rec.pendingNewTask = false; rec.state = "draft"; saveProject(rec);
      journalEvent({ type: "goal-switched", projectId, to: ng.title });
      return { ok: true, goalId: ng.id };
    }
    case "switch-goal": {
      if (!findById(sk.goals, params.id)) return { ok: false, message: "目标不存在" };
      sk.currentGoalId = params.id;
      const werr = saveSk(sk); if (werr) return werr;
      journalEvent({ type: "goal-switched", projectId, to: findById(sk.goals, params.id).title });
      return { ok: true };
    }
    case "rename-goal": {
      const g = findById(sk.goals, params.id);
      if (!g) return { ok: false, message: "目标不存在" };
      const t = normText(params.title);
      if (!t) return { ok: false, message: "名称为空" };
      g.title = t; g.at = now();
      const werr = saveSk(sk); if (werr) return werr;
      return { ok: true };
    }
    case "remove-goal": {
      const g = findById(sk.goals, params.id);
      if (!g) return { ok: false, message: "目标不存在" };
      if (sk.goals.length <= 1) return { ok: false, message: "至少要留一个目标" };
      sk.goals = sk.goals.filter((x) => x.id !== params.id);
      if (sk.currentGoalId === params.id) sk.currentGoalId = sk.goals[0].id;   // 删掉当前目标 → 回落到第一个
      const werr = saveSk(sk); if (werr) return werr;
      journalEvent({ type: "goal-removed", projectId, title: g.title });
      return { ok: true };
    }
    case "remove-item": {
      // params: { dim, mod, id }（九模块）；旧调用兼容 {layer}
      const mod = params.mod || params.layer;
      const dim = params.dim || (MODULE_SET.has(mod) ? moduleDim(mod) : null);
      if (!dim || !MODULE_SET.has(mod)) return { ok: false, message: "未知模块" };
      const bucket = goal.dims?.[dim]?.[mod];
      if (!Array.isArray(bucket)) return { ok: false, message: "模块不存在" };
      goal.dims[dim][mod] = bucket.filter((x) => x.id !== params.id);
      const werr = saveSk(sk); if (werr) return werr;
      saveProject(rec);
      journalEvent({ type: "item-removed", projectId, module: mod });
      return { ok: true };
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
  const counts = { why: 0, what: 0, how: 0 };
  let total = 0;
  if (goal?.dims) {
    for (const [dim, dd] of Object.entries(DIMS)) {
      for (const mod of Object.keys(dd.modules)) {
        const n = (goal.dims[dim]?.[mod] || []).length;
        counts[dim] += n;
        total += n;
      }
    }
  }
  return {
    id: projectId,
    title: rec.title,
    projectDir: rec.projectDir,
    state: rec.state,
    harnesses: rec.harnesses || [],
    pendingNewTask: !!rec.pendingNewTask,
    updatedAt: rec.updatedAt,
    currentGoal: goal ? goal.goal || goal.title : "",
    counts: { ...counts, total },
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

/** 给 agent 看的紧凑文本视图（三维九模块） */
export function queryMarkdown(cwd, harness = "unknown") {
  // 显式 id（t_/p 白名单）直接读档案；否则按目录推导（兼容旧调用方）
  const rec = isValidId(cwd) && loadProject(cwd) ? loadProject(cwd) : resolveProject(cwd, harness);
  const s = summarize(rec.id, rec);
  const sk = readSkeleton(rec.id);
  const g = sk ? currentGoal(sk) : null;
  const sections = [];
  for (const [dim, dd] of Object.entries(DIMS)) {
    const parts = [];
    for (const [mod, m] of Object.entries(dd.modules)) {
      const arr = g?.dims?.[dim]?.[mod] || [];
      if (arr.length) parts.push(`${m.label}（${arr.length}）：\n` + arr.map((x) => `- ${x[m.textKey]}`).join("\n"));
    }
    if (parts.length) sections.push(`\n${dd.label}：\n` + parts.join("\n"));
  }
  const md =
    `【思维板】${s.title}\n` +
    `目标：${s.currentGoal || "（未定）"}\n状态：${s.state}｜条目 ${s.counts.total}` +
    sections.join("");
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
  let n = 0, skipped = 0;
  for (const [oldId, item] of Object.entries(data.tasks)) {
    // 导入数据一律视为不可信：id 必须过白名单（否则 ../../ 可穿越写盘到任意位置）
    if (!isValidId(oldId) || !item || typeof item.task !== "object") { skipped++; continue; }
    // 单条任务体积上限 1MB，防巨型导入撑爆磁盘/内存
    try { if (JSON.stringify(item).length > 1024 * 1024) { skipped++; continue; } } catch { skipped++; continue; }
    // 新 id 防冲突
    const nid = existsSync(projectPath(oldId) || "\0")
      ? "p" + randomUUID().slice(0, 8) : oldId;
    const rec = { ...item.task, id: nid };
    // 老数据没有 harnesses：补上来源 + harness 兜底（否则全进 "other"，图标坞被 42 枚爪印淹没）
    if (!Array.isArray(rec.harnesses) || !rec.harnesses.length) {
      rec.harness = rec.harness && rec.harness !== "unknown" ? rec.harness : from;
      rec.harnesses = [rec.harness];
    }
    writeJson(projectPath(nid), rec);
    if (item.skeleton && typeof item.skeleton === "object") writeJson(skeletonPath(nid), item.skeleton);
    n++;
  }
  journalEvent({ type: "imported", count: n, skipped });
  return { ok: true, imported: n, ...(skipped ? { skipped } : {}) };
}
