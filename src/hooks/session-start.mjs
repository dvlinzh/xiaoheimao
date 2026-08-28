// SessionStart 钩子 —— 注入思维板全量协议（每会话一次；compaction 后由 source=compact 重新触发）
// stdout 即注入内容。mode=off 时静默退出。
import { readSettings, overview } from "../core/store.mjs";
import { FULL_PROTOCOL } from "../core/protocol.mjs";

const settings = readSettings();
if (settings.mode !== "on") process.exit(0);

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
let input = {};
try { input = JSON.parse(stdin || "{}"); } catch {}

// 全量协议 + 当前目录项目速览（如有）
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let ctx = FULL_PROTOCOL;
try {
  const ov = overview();
  const dir = (cwd || "").toLowerCase();
  const hit = ov.projects.find((p) => (p.projectDir || "").toLowerCase() === dir);
  if (hit) {
    ctx += `\n\n当前项目已有骨架：目标「${hit.currentGoal || "未定"}」，缺口 ${hit.counts.gaps} 条待补全。`;
  }
} catch {}
process.stdout.write(ctx);
