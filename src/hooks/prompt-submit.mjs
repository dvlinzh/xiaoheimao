// UserPromptSubmit 钩子 —— 每轮注入一行短状态（提醒不丢、上下文省95%，与原插件策略一致）
// mode=off 静默；无骨架则给出极短启用提示。
import { readSettings, overview, tickMessage } from "../core/store.mjs";
import { statusLine } from "../core/protocol.mjs";
import { resolve } from "node:path";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";

const settings = readSettings();
if (settings.mode !== "on") process.exit(0);

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  const ov = overview();
  // 目录归一化后再比：正/反斜杠形式不同，裸比较永不命中（见 session-start.mjs）
  const dir = resolve(cwd).toLowerCase();
  const hit = ov.projects.find((p) => p.projectDir && resolve(p.projectDir).toLowerCase() === dir);
  // 每轮打点：到了整理频率就把催促塞进状态行
  const tick = hit ? tickMessage(hit.projectDir) : null;
  // 调试追踪：钩子的 HOME/env 与应用进程可能不同源（曾导致写盘落到别处、
  // 图标环因 mtime 过期而清空）。稳定后可移除。
  try {
    appendFileSync(resolve(homedir(), ".mind-board", "hook-debug.log"),
      JSON.stringify({
        at: new Date().toISOString(), home: homedir(),
        mbh: process.env.MIND_BOARD_HOME || null,
        cpd: process.env.CLAUDE_PROJECT_DIR || null, cwd,
        hit: hit?.id || null, counter: tick?.counter ?? null,
      }) + "\n");
  } catch {}
  process.stdout.write(statusLine(hit || null, tick ? { due: tick.due, counter: tick.counter, interval: tick.interval } : {}));
} catch {}
