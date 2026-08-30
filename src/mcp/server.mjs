// mind-board-pet — MCP server（src/mcp/server.mjs）
// 以 stdio JSON-RPC 暴露两个工具给任意支持 MCP 的 harness：
//   · mind_board_organize —— 增量整理四层骨架
//   · mind_board_control  —— 目标/条目级宿主动作
//   · mind_board_query    —— 读当前骨架的紧凑文本
// 被各 harness 的配置拉起；Claude Code / Codex / Gemini CLI 均兼容。

import { resolve } from "node:path";
import * as store from "../core/store.mjs";

const HARNESS_DEFAULT = process.env.MIND_BOARD_HARNESS || "unknown";

/* ─────────────── 工具 schema ─────────────── */

const TOOLS = [
  {
    name: "mind_board_organize",
    description:
      "把对话中产生的想法整理进思维板四层骨架。何时调用：用户表达了新想法、结论要点、候选方案或未想清的问题时，随回复一并调用。" +
      "调用前先自查分类是否准确；没说清的一律进 gaps 缺口，不要脑补。",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "当前项目工作目录（必填，用于区分不同项目的骨架）" },
        goalTitle: { type: "string", description: "目标标题（≤20字）。仅当首次建立或用户明确改向时提供" },
        goal: { type: "string", description: "一句话目标描述（≤30字）。仅当首次建立或用户明确改向时提供" },
        ideas: {
          type: "array",
          items: {
            type: "object", properties: {
              text: { type: "string", description: "想法归纳（≤30字）：压缩短句，不摘原话" },
              raw: { type: "string", description: "用户原话（可选，≤200字）：归纳前的原始表达，供追溯" },
              group: { type: "string", description: "可选分组名（≤12字），同类想法归并" },
              done: { type: "boolean", description: "已实现/已采纳" },
            }, required: ["text"],
          },
        },
        points: {
          type: "array",
          items: {
            type: "object", properties: {
              text: { type: "string", description: "要点预览（≤40字）：结论/表格/分析图/项目地图的提炼" },
              decided: { type: "boolean", description: "已敲定的结论" },
              link: { type: "string", description: "完整版链接（http(s) 本地/远程 URL），面板点击打开" },
              supersedes: { type: "array", items: { type: "string" }, description: "被本结论取代的旧条目（id 或原文）" },
            }, required: ["text"],
          },
        },
        plans: {
          type: "array",
          items: {
            type: "object", properties: {
              title: { type: "string", description: "方案标题（≤25字）" },
              group: { type: "string", description: "所属问题/缺口（≤16字）——并列的方案同组，读的人才知道每组在解决什么" },
              chosen: { type: "boolean", description: "当前采用（同一时刻至多一个方案为 true）" },
              dismissed: { type: "boolean", description: "已否决" },
              paths: { type: "array", items: { type: "object", properties: { step: { type: "string" } } } },
            }, required: ["title"],
          },
        },
        gaps: {
          type: "array",
          items: {
            type: "object", properties: {
              text: { type: "string", description: "缺口——还没想清/没验证的点（≤25字）" },
              resolved: { type: "boolean", description: "已解决" },
            }, required: ["text"],
          },
        },
      },
      required: ["cwd"],
    },
  },
  {
    name: "mind_board_control",
    description:
      "思维板宿主动作。需要用户新建/切换目标、归档任务时调用。动作：new-goal{title,goal?} | switch-goal{id} | archive{} | remove-item{layer,id} 等。" +
      "重要：当 organize 返回 pendingNewTask 时，必须先询问用户确认，得到同意后调用本工具 new-goal 动作。",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "当前项目工作目录" },
        action: { type: "string", enum: ["new-goal", "switch-goal", "archive", "reopen", "remove-item", "toggle-point", "toggle-done", "toggle-gap", "choose-plan", "dismiss-plan"], description: "动作名" },
        params: { type: "object", description: "动作参数（如 id/title/layer）" },
      },
      required: ["cwd", "action"],
    },
  },
  {
    name: "mind_board_query",
    description: "读取当前项目的思维板骨架（紧凑文本视图）。在注入提醒或回答『现在的思路是什么』时使用。",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "当前项目工作目录" },
      },
      required: ["cwd"],
    },
  },
];

/* ─────────────── 工具实现 ─────────────── */

function fmtResult(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj.applied || {})) {
    lines.push(`${k}: ${v}`);
  }
  const head = obj.ok ? "已记入思维板。" : "未变更。";
  let text = head + (lines.length ? `\n新增 ${lines.join("、")}` : "");
  if (obj.message && obj.pendingNewTask) return { isError: true, text: `⚠ ${obj.message}` };
  if (!obj.ok && obj.message) return { isError: true, text: `⚠ ${obj.message}` };
  return { content: [{ type: "text", text }] };
}

function dispatch(name, args = {}) {
  const cwd = args.cwd || process.cwd();
  switch (name) {
    case "mind_board_organize": {
      const rec = store.resolveProject(cwd, HARNESS_DEFAULT);
      const res = store.organize(rec.id, { ...args, harness: HARNESS_DEFAULT });
      return { _raw: res, tool: name };
    }
    case "mind_board_control": {
      const rec = store.resolveProject(cwd, HARNESS_DEFAULT);
      // 动作里涉及具体目标的操作，cwd 解析出的就是该项目
      if (args.action === "new-goal") {
        const res2 = store.controlAction(rec.id, { action: "new-goal", params: args.params || {} });
        return { _raw: res2, tool: name };
      }
      // 其他动作可能带 projectId 参数（气泡端没有 MCP，不经此路径；agent 端按 cwd 操作当前项目即可）
      const res3 = store.controlAction(rec.id, { action: args.action, params: { ...(args.params || {}), ...(args.params?.id ? {} : {}) } });
      return { _raw: res3, tool: name };
    }
    case "mind_board_query": {
      const q = store.queryMarkdown(cwd, HARNESS_DEFAULT);
      return { _raw: q, tool: name };
    }
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

function present(name, raw) {
  if (name === "mind_board_query") {
    return { content: [{ type: "text", text: raw.markdown || "(空骨架)" }] };
  }
  return fmtResult(raw);
}

/* ─────────────── JSON-RPC over stdio ─────────────── */

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.jsonrpc !== "2.0") return;
  if (typeof msg.id === "undefined") return; // notification，忽略

  let result, error;
  try {
    switch (msg.method) {
      case "initialize":
        result = {
          protocolVersion: msg.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mind-board-pet", version: "0.1.0" },
        };
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const name = msg.params?.name;
        const out = dispatch(name, msg.params?.arguments);
        result = present(name, out._raw);
        break;
      }
      case "ping":
        result = {};
        break;
      default:
        error = { code: -32601, message: `method not found: ${msg.method}` };
    }
  } catch (e) {
    error = { code: -32000, message: String(e?.message || e) };
  }
  const resp = { jsonrpc: "2.0", id: msg.id };
  if (error) resp.error = error; else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + "\n");
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
