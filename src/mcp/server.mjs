// mind-board-pet — MCP server（src/mcp/server.mjs）
// 以 stdio JSON-RPC 暴露两个工具给任意支持 MCP 的 harness：
//   · mind_board_organize —— 增量整理四层骨架
//   · mind_board_control  —— 目标/条目级宿主动作
//   · mind_board_query    —— 读当前骨架的紧凑文本
// 被各 harness 的配置拉起；Claude Code / Codex / Gemini CLI 均兼容。

import { resolve } from "node:path";
import * as store from "../core/store.mjs";
import { TOOLS } from "./tools.mjs";
import pkg from "../../package.json" with { type: "json" };

const HARNESS_DEFAULT = process.env.MIND_BOARD_HARNESS || "unknown";

// 工具 schema 再导出：兼容仍从 server.mjs 取 TOOLS 的旧调用方
export { TOOLS };

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
  // 整理模式总开关：与 README 承诺一致（「钩子与 MCP 受整理模式开关控制」）。
  // 此前只挡了 hooks 没挡 MCP——关掉开关后 MCP 仍在写盘。query 是只读，放行。
  if (name !== "mind_board_query" && store.readSettings().mode !== "on") {
    return { _raw: { ok: false, message: "整理模式已关闭（右键猫 → 设置窗 可开启）" }, tool: name };
  }
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
          serverInfo: { name: "mind-board-pet", version: pkg.version },
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
