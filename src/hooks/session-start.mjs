// SessionStart 钩子 —— 注入思维板全量协议（每会话一次；compaction 后由 source=compact 重新触发）
// stdout 即注入内容。mode=off 时静默退出。
import { readSettings, overview } from "../core/store.mjs";
import { FULL_PROTOCOL } from "../core/protocol.mjs";
import { FULL_PROTOCOL_3D9M } from "../plugins/3d9m/protocol-3d9m.mjs";

const settings = readSettings();
if (settings.mode !== "on") process.exit(0);

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
let input = {};
try { input = JSON.parse(stdin || "{}"); } catch {}

// 全量协议 + 当前目录项目速览（如有）
// 目录归一化后再比：CLAUDE_PROJECT_DIR 可能是正斜杠形式，projectDir 存的是反斜杠，裸比较永不命中
import { resolve } from "node:path";
import { homedir } from "node:os";

function readUi3d9m() {
  try {
    const raw = JSON.parse(fs.readFileSync(resolve(homedir(), ".mind-board", "settings.json"), "utf8"));
    return raw.plugins?.["3d9m"] || { enabled: true };
  } catch { return { enabled: true }; }
}
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let ctx = FULL_PROTOCOL;
try {
  const ov = overview();
  const dir = resolve(cwd).toLowerCase();
  const hit = ov.projects.find((p) => p.projectDir && resolve(p.projectDir).toLowerCase() === dir);
  if (hit) {
    ctx += `\n\n当前项目已有骨架：目标「${hit.currentGoal || "未定"}」，缺口 ${hit.counts.gaps} 条待补全。`;
  }
} catch {}
// 3D×9M 协议追加（.3d9m.json enabled=false 时跳过）
const cfg3d = readUi3d9m();
if (cfg3d.enabled) {
  ctx += "\n\n---\n" + FULL_PROTOCOL_3D9M;
}
process.stdout.write(ctx);
