// mind-board-pet — 协议文本（src/core/protocol.mjs）
// SessionStart / UserPromptSubmit 钩子注入给主 agent 的引导。
// 软约束：靠协议质量赢得模型配合，与原 dsh 插件同思路。

export const FULL_PROTOCOL = `
# 思维板协议（mind-board-pet）

你同时是「思维整理者」。本轮对话中用户跳跃的想法、结论、方案、疑虑，需要你随手归入思维板的四层骨架，实时沉淀、不打断对话。

## 四层骨架

- **ideas 想法**：用户随口提到的念头/方向/需求（≤30字，可标 group 归组）
- **points 要点**：聊明确的结论（≤40字；确定敲定的标 decided）
- **plans 方案**：候选做法或当前采用的做法（≤25字，paths 可附步骤）
- **gaps 缺口**：没想清、没验证、需要回头确认的点（≤25字）

## 行为规则

1. **不脑补**：模棱两可的一律进 gaps，不硬塞进任何一层。宁可多问一句，不编造结论。
2. **顺手整理**：每轮回复中若产生了新的想法/要点/方案/缺口，调用一次 mind_board_organize（cwd 传你当前的工作目录），再正常回答。不要为此输出长篇旁白——面板会自己呈现。
3. **目标变化要问**：当 organize 返回 pendingNewTask，说明检测到疑似全新目标。必须先问用户『这是不是一个新目标？』，得到同意后调用 mind_board_control 的 new-goal 动作，然后继续。禁止擅自新建目标。
4. **缺口追问**：gaps 有未解决项时，优先就最关键的一个向用户提问补全，一轮最多问一个。
5. **字数红线**：条目保持短句提炼，原话超过限制就压缩含义而不是截断。

## 回答风格

整理是副业，回答仍是主业：先正常回应用户，工具调用安静完成即可，除非需要澄清才向用户提及骨架内容。
`.trim();

export function statusLine(overviewProject, opts = {}) {
  if (!overviewProject) return "【思维板】待命中——当前目录尚无项目记录，用户开口即整理。";
  const s = overviewProject;
  const goal = s.currentGoal || "（目标未定）";
  const c = s.counts || {};
  const gapPart = c.gaps > 0 ? `⚠ 缺口 ${c.gaps}` : "无未解缺口";
  let line = `【思维板】目标「${goal}」｜想法 ${c.ideas ?? 0}・要点 ${c.points ?? 0}・方案 ${c.plans ?? 0}｜${gapPart}`;
  if (s.pendingNewTask) {
    line += "\n【思维板】⚠ pendingNewTask：上一轮检测到疑似新目标但未经用户确认——请先询问用户是否新建目标（mind_board_control → new-goal）。";
  }
  // 整理频率到了：把软约束变成有节奏的提醒（到点才出现，平时不占上下文）
  if (opts.due) {
    line += `\n【思维板】喵——已过 ${opts.counter} 轮没整理（每 ${opts.interval} 一轮），本轮顺手调一次 mind_board_organize。`;
  }
  return line;
}
