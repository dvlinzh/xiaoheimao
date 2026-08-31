// UserPromptSubmit 钩子 —— 每轮注入一行短状态（提醒不丢、上下文省95%，与原插件策略一致）
// mode=off 静默；无骨架则给出极短启用提示。
import { readSettings, overview, tickMessage, fullSkeleton } from "../core/store.mjs";
import { statusLine } from "../core/protocol.mjs";
import { statusLine3D9M, getModuleStatus } from "../plugins/3d9m/protocol-3d9m.mjs";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
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
  let out = statusLine(hit || null, tick ? { due: tick.due, counter: tick.counter, interval: tick.interval } : {});
  // 3D×9M 状态行（on-change 模式：仅阶段切换时注入）
  const cfg3d = read3d9mConfig();
  if (cfg3d.enabled && cfg3d.statusLineMode !== "off" && hit) {
    const sk = fullSkeleton(hit.id)?.skeleton;
    if (sk) {
      const ms = getModuleStatus(sk);
      const stage = read3d9mStage(hit.id);
      const line3d = statusLine3D9M({ stage, valueDone: ms.valueDone, structDone: ms.structDone, pathDone: ms.pathDone, currentGoal: hit.currentGoal });
      if (cfg3d.statusLineMode === "on-change") {
        // 阶段切换时才注入（与上一轮不同）
        const stageFile = resolve(homedir(), ".mind-board", ".3d9m-stage");
        const prev = Number(fs.readFileSync(stageFile, "utf8") || -1);
        if (prev !== stage) { fs.writeFileSync(stageFile, String(stage)); out += "\n" + line3d; }
      } else {
        out += "\n" + line3d;
      }
    }
  }
  process.stdout.write(out);
} catch {}

function read3d9mConfig() {
  try {
    const raw = JSON.parse(readFileSync(resolve(homedir(), ".mind-board", "settings.json"), "utf8"));
    return raw.plugins?.["3d9m"] || { enabled: true, statusLineMode: "on-change" };
  } catch { return { enabled: true, statusLineMode: "on-change" }; }
}

function read3d9mStage(projectId) {
  try {
    const sk = JSON.parse(readFileSync(resolve(homedir(), ".mind-board", "skeletons", projectId + ".json"), "utf8"));
    return sk.stage3d9m ?? 0;
  } catch { return 0; }
}
