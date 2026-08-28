// UserPromptSubmit 钩子 —— 每轮注入一行短状态（提醒不丢、上下文省95%，与原插件策略一致）
// mode=off 静默；无骨架则给出极短启用提示。
import { readSettings, overview, tickMessage } from "../core/store.mjs";
import { statusLine } from "../core/protocol.mjs";

const settings = readSettings();
if (settings.mode !== "on") process.exit(0);

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  const ov = overview();
  const dir = (cwd || "").toLowerCase();
  const hit = ov.projects.find((p) => (p.projectDir || "").toLowerCase() === dir);
  // 每轮打点：到了整理频率就把催促塞进状态行
  const tick = hit ? tickMessage(hit.projectDir) : null;
  process.stdout.write(statusLine(hit || null, tick ? { due: tick.due, counter: tick.counter, interval: tick.interval } : {}));
} catch {}
