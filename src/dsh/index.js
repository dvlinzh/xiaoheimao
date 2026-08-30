// mind-board-pet — DSH Cordis 宿主适配器（多入口设计 · 入口 D）
// 本文件只做「DSH 接线」，业务逻辑全部复用 src/core/（与 MCP 服务器 / hooks / Electron 壳共用）：
//   1. 工具注册 —— mind_board_organize / query / control（schema 与 MCP 侧同源，参数用 projectId）
//   2. 事件钩子 —— agent/pre-step 注入协议（协议一次 + 状态行每轮 + 整理节奏 + 防归错提醒）
//                  session/event 驱动任务生命周期（会话→任务绑定、计数、疑似新主题检测）
//   3. HTTP API —— webServer 挂 /mind-board-pet/*（DSH 无 pet 独立服务时数据层仍可用）
// 数据与 Claude Code 侧完全共享：同一份 ~/.mind-board，同一套 store 原子写盘。
// 与原有 dsh-mind-board 插件二选一安装（行为都是整理注入，双装会双份提醒）。
import { resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync, cpSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import * as store from "../core/store.mjs";
import { FULL_PROTOCOL, statusLine } from "../core/protocol.mjs";
import { TOOLS } from "../mcp/server.mjs";

export const name = "mind-board-pet";
export const inject = ["webServer"];

/** 唤醒词：用户在 DSH 里喊「喵喵喵 / mind cat / 思维助手」→ 唤起桌面小黑猫（尽力而为） */
const WAKE_RE = /(喵喵|mind\s*cat|思维助手)/i;

function wakePet() {
  try {
    let info = null;
    try { info = JSON.parse(readFileSync(resolve(store.ROOT, "tray.json"), "utf8")); } catch {}
    if (!info?.port) return;
    fetch("http://127.0.0.1:" + info.port + "/pet/wake", { method: "POST" }).catch(() => {});
  } catch {}
}

/** 旧 DSH 专属数据目录 → 通用数据根的一次性整体复制（原目录保留作备份） */
function migrateLegacyHome() {
  try {
    if (process.env.MIND_BOARD_HOME) return;
    const legacyHome = resolve(process.env.DSH_HOME || resolve(homedir(), ".dsh"), ".mind-board");
    if (resolve(legacyHome) === store.ROOT || !existsSync(legacyHome)) return;
    const dirEmpty = (p) => !existsSync(p) || readdirSync(p).filter((f) => f.endsWith(".json")).length === 0;
    const fresh = !existsSync(resolve(store.ROOT, "settings.json"));
    if (!fresh) return;
    cpSync(legacyHome, store.ROOT, { recursive: true });
    store.journalEvent({ type: "home-migrated", from: legacyHome, to: store.ROOT });
  } catch {}
}
migrateLegacyHome();

/** 构造一条 user-role 协议消息（打插件标记，UI 可识别、压缩可剔除） */
function protocolMessage(text) {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: name },
  };
}

/** 会话的当前任务：sessionId 匹配者取最新；无则 null（t_ 任务由 session/event 自动创建） */
function activeTaskFor(sessionId) {
  const recs = store.allRecords().filter((r) => r.sessionId === sessionId);
  if (!recs.length) return null;
  return recs.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0))[0];
}

/** 单任务轮廓文本（目标/计数/缺口），供协议注入附加 projectId */
function taskBrief(id) {
  const data = store.fullSkeleton(id);
  const s = data?.summary;
  if (!s) return "";
  const c = s.counts || {};
  return `【当前任务】projectId=「${id}」｜目标「${s.currentGoal || "未定"}」｜想法 ${c.ideas ?? 0}・要点 ${c.points ?? 0}・方案 ${c.plans ?? 0}｜缺口 ${c.gaps ?? 0}${s.pendingNewTask ? "｜⚠ 疑似新主题待确认" : ""}`;
}

/** 骨架紧凑文本（query 工具返回值；格式对齐 store.queryMarkdown） */
function queryText(id) {
  const data = store.fullSkeleton(id);
  if (!data) return "(空骨架)";
  const { summary: s, skeleton: sk } = data;
  const g = sk?.goals?.find((x) => x.id === sk.currentGoalId);
  const sec = (layer, label, fmt) =>
    g && g[layer].length ? `\n${label}（${g[layer].length}）：\n` + g[layer].map(fmt).join("\n") : "";
  return (
    `【思维板】${s.title}\n` +
    `目标：${s.currentGoal || "（未定）"}\n状态：${s.state}｜未想清缺口 ${s.counts.gaps}` +
    sec("ideas", "想法", (i) => `- ${i.text}${i.done ? " ✅" : ""}`) +
    sec("points", "要点", (p) => `- ${p.text}${p.decided ? " ✔" : ""}`) +
    sec("plans", "方案", (p) => `- ${p.title}${p.chosen ? "【当前采用】" : p.dismissed ? "【已否决】" : ""}`) +
    sec("gaps", "缺口", (x) => `- ${x.text}${x.resolved ? "（已解决）" : ""}`)
  );
}

/** 每个会话的首轮检查与手动档疑似提醒，只触发一次 */
const firstCheckSessions = new Set();
const manualSuspectPrompts = new Set();

export function apply(ctx) {
  /* ────────────────────── 工具注册（execute 走 store，与 MCP 侧同语义） ────────────────────── */
  const tools = ctx.get?.("tools");
  if (tools && typeof tools.register === "function") {
    // 跨入口统一：schema 从 mcp/server.mjs 的 TOOLS 派生；仅把 cwd 换成 projectId
    // （DSH 的工具调用方是主 agent，它从注入的状态行拿到当前 projectId，按 id 寻址）。
    const byName = {};
    for (const t of TOOLS) byName[t.name] = t;
    const toProjectArgs = (name, args = {}) => {
      const { projectId, ...rest } = args;
      return { ...rest, cwd: projectId || process.cwd() };
    };
    const mkTool = (name, executeFn) => {
      const src = byName[name];
      const inputSchema = JSON.parse(JSON.stringify(src.inputSchema));
      const props = inputSchema.properties || {};
      // cwd（目录寻址）→ projectId（任务寻址）：DSH 语义是「话题归属=会话任务」
      if (props.cwd) { props.projectId = { type: "string", description: "当前任务 id（注入的状态行里有；必填）" }; delete props.cwd; }
      if (inputSchema.required) {
        inputSchema.required = inputSchema.required.map((k) => (k === "cwd" ? "projectId" : k));
      }
      return {
        name,
        description: src.description + "（DSH 版参数：projectId 替代 cwd）",
        parameters: inputSchema,
        isConcurrencySafe: () => true,
        async execute(args) {
          const pid = String(args?.projectId || "");
          if (!pid) return { ok: false, error: "缺 projectId（见注入状态行的【当前任务】）" };
          return executeFn(pid, args);
        },
      };
    };
    try {
      tools.register(mkTool("mind_board_organize", (pid, args) => {
        const r = store.organize(pid, { ...args, harness: "dsh" });
        return r.ok ? { ok: true, applied: r.applied }
                    : { ok: false, error: r.message || "写入失败", pendingNewTask: !!r.pendingNewTask };
      }));
      tools.register(mkTool("mind_board_control", (pid, args) => {
        const r = store.controlAction(pid, { action: args.action, params: args.params || {} });
        return Promise.resolve(r.ok ? { ok: true, ...r } : { ok: false, error: r.message || "动作失败" });
      }));
      tools.register(mkTool("mind_board_query", (pid) => {
        return Promise.resolve({ ok: true, text: queryText(pid) });
      }));
      store.journalEvent({ type: "organize-note", projectId: "", note: "mind_board_pet DSH 工具已注册（organize/control/query）" });
    } catch (e) {
      ctx.logger?.warn?.("mind-board-pet tool register failed: %o", e?.message || e);
    }
  } else {
    store.journalEvent({ type: "organize-note", projectId: "", note: "tools 服务不可用，DSH 侧整理工具未注册（靠协议）" });
  }

  /* ────────────────────── agent/pre-step：协议注入 ────────────────────── */
  ctx.on("agent/pre-step", async ({ agent, messages, step, signal }, next) => {
    const decision = await next();
    try {
      if (!agent?.session) return decision;
      const sessionId = agent.session.id;
      if (typeof sessionId !== "string") return decision;
      if (store.readSettings().mode !== "on") return decision;   // 开关门禁：关掉就不打扰
      const task = activeTaskFor(sessionId);
      if (!task) return decision;
      let text = "";
      let isBrief = false;
      // 全量协议：每会话一次（compaction 后由下方事件重置重注）
      if (!task.injectedFull) {
        text = FULL_PROTOCOL;
        // 任务行附在协议后：agent 从第一条注入起就知道 projectId，才能调工具
        const brief = taskBrief(task.id);
        if (brief) text = "【当前任务】" + brief.replace(/^【当前任务】/, "") + "\n\n" + text;
      }
      // 整理节奏：到档位 → 注入强整理指令（只注一次）
      if (!text && task.organizePending) {
        store.touchRecord(task.id, { organizePending: false });
        text = "【思维板】喵——到整理档位了，本轮顺手调一次 mind_board_organize（projectId=" + task.id + "），再正常回答。";
        isBrief = true;
      }
      // 疑似换主题：pendingNewTask 时注入「先弹卡片确认归属」（每 (session,ts) 一次）
      if (!text && task.pendingNewTask) {
        const key = sessionId + ":" + (task.pendingNewTask.ts || "");
        if (!manualSuspectPrompts.has(key)) {
          manualSuspectPrompts.add(key);
          text = "【思维板】⚠ 检测到疑似新主题：请先 ask_user_question 问用户『这是一个新任务还是当前任务的延续？』，确认后再决定是否用 mind_board_control 的 new-goal 新建目标。";
          isBrief = true;
        }
      }
      // 每轮短状态行
      if (!text) {
        const brief = taskBrief(task.id);
        if (brief) { text = brief; isBrief = true; }
      }
      // 首轮检查（手动档跳过）
      if (!firstCheckSessions.has(sessionId) && taskBrief(task.id)) {
        firstCheckSessions.add(sessionId);
        const check = "【首轮检查】先判断这条消息与当前目标是否一致：一致→正常对话；不一致→这是『可能的新目标/新任务』，先弹卡片问用户，是就 new-goal，不是就归当前任务。";
        text = text ? check + "\n" + text : check;
      }
      if (!text) return decision;
      const desired = protocolMessage(text);
      const lastClaimedIndex = decision.messages.findLastIndex((m) => messages.includes(m));
      const injectIndex = lastClaimedIndex < 0 ? Math.max(0, decision.messages.length - 1) : lastClaimedIndex;
      if (isBrief) store.touchRecord(task.id, { statusDirty: false });
      else store.touchRecord(task.id, { injectedFull: true });
      return {
        kind: "enter",
        messages: decision.messages.toSpliced(injectIndex + 1, 0, desired),
      };
    } catch (e) {
      ctx.logger?.warn?.("mind-board-pet pre-step failed: %o", e);
      return decision;
    }
  });

  /* ────────────────────── session/event：任务生命周期 ────────────────────── */
  ctx.on("session/event", (session, event) => {
    try {
      const sessionId = session?.id;
      if (typeof sessionId !== "string") return;
      // 压缩后重注全量协议（防说明书丢失）
      if (event.type === "compaction/end") {
        const active = activeTaskFor(sessionId);
        if (active && store.readSettings().mode === "on") {
          store.touchRecord(active.id, { injectedFull: false, statusDirty: false });
          store.journalEvent({ type: "protocol-reinject", projectId: active.id, reason: "compaction/end" });
        }
        return;
      }
      if (event.type !== "user/message") return;
      const src = event.data?.source;
      if (src?.kind !== "user") return;
      let text = "";
      const content = event.data?.content;
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        for (const block of content) if (block?.type === "text") text += block.text || "";
      }
      text = String(text || "").trim();
      if (WAKE_RE.test(text)) wakePet();
      if (store.readSettings().mode !== "on") return;
      let task = activeTaskFor(sessionId);
      if (!task) {
        // 新会话首条消息 = 自动建任务（过短的口水话不建）
        if (text.length < 2) return;
        const id = "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
        task = store.createSessionRecord(id, { title: text.slice(0, 30), sessionId });
        store.journalEvent({ type: "task-created", projectId: id, auto: true });
      }
      // 疑似新主题（机械检测）：消息与目标相似度过低 → 挂 pendingNewTask，由 pre-step 提醒弹卡片
      const data = store.fullSkeleton(task.id);
      const goalText = (data?.summary?.currentGoal || "").trim();
      if (goalText && text.length >= 4) {
        const sim = store.charJaccard(text, goalText);
        if (sim < 0.25) {
          store.touchRecord(task.id, { pendingNewTask: { text: text.slice(0, 120), ts: new Date().toISOString(), sim: +sim.toFixed(3) } });
          store.journalEvent({ type: "suspect-switch", projectId: task.id, sim: +sim.toFixed(3) });
        }
      }
      // 整理计数：到档位置 organizePending（pre-step 注入强指令）
      const interval = store.readSettings().organizeInterval || 2;
      const rec = store.touchRecord(task.id, { statusDirty: true, msgCounter: (task.msgCounter || 0) + 1 });
      if (rec && (rec.msgCounter || 0) >= interval) {
        store.touchRecord(task.id, { organizePending: true, msgCounter: 0 });
      }
      store.journalEvent({ type: "user-message", projectId: task.id });
    } catch { /* non-fatal */ }
  });

  /* ────────────────────── HTTP API：/mind-board-pet/* ────────────────────── */
  const dispose = ctx.webServer.register({
    kind: "prefix",
    path: "/mind-board-pet",
    handler: createApiRoute(),
  });
  // test-only：供壳冒烟测试直取内部文本生成器
  ctx._taskBrief = (id) => taskBrief(id);
  return () => { dispose(); };
}

/** 数据路由：DSH 无独立 pet 服务时，面板/外部仍可经此读写 */
function createApiRoute() {
  return (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const sendJson = (obj, code = 200) => {
      try { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); } catch {}
    };
    const readBody = async () => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
    };
    const route = async () => {
      const p = url.pathname, q = url.searchParams;
      if (req.method === "GET" && p === "/overview") return sendJson(store.overview());
      if (req.method === "GET" && p === "/skeleton") {
        const d = store.fullSkeleton(q.get("id") || "");
        return d ? sendJson(d) : sendJson({ error: "not found" }, 404);
      }
      if (req.method === "GET" && p === "/statusline") {
        const d = store.fullSkeleton(q.get("projectId") || "");
        return sendJson({ text: d ? taskBrief(q.get("projectId")) : "" });
      }
      if (req.method === "POST" && p === "/organize") {
        const body = await readBody();
        const id = body.projectId || body.cwd;
        if (!id) return sendJson({ ok: false, message: "projectId 必填" });
        return sendJson(store.organize(id, { ...body, harness: body.harness || "dsh" }));
      }
      if (req.method === "POST" && p === "/action") {
        const body = await readBody();
        if (!body.projectId || !body.action) return sendJson({ ok: false, message: "projectId/action 必填" });
        return sendJson(store.controlAction(body.projectId, { action: body.action, params: body.params || {} }));
      }
      return sendJson({ error: "no such route" }, 404);
    };
    route().catch((e) => sendJson({ error: String(e?.message || e) }, 500));
  };
}

// 供测试/文档确认
export { store };
