// mind-board-pet — MCP 工具 schema（独立文件）
// 单独成文件的原因：DSH Cordis 壳（src/dsh/index.js）要复用同一份契约，
// 若从 server.mjs 导入会顺带执行其顶层 stdio 监听，污染宿主进程的 stdin/stdout。
//
// 数据结构：三维九模块（价值维/结构维/路径维 × 每维三模块，见 core/store.mjs DIMS）。
// organize 的 payload 直接平铺九个模块键（anchor/audience/proposition/modules/
// skeleton/boundaries/link/bottlenecks/feedback），每条目 {text|title, ...}。
export const TOOLS = [
  {
    name: "mind_board_organize",
    description:
      "把对话中产生的想法/结论/方案/疑虑整理进思维板三维九模块骨架。何时调用：用户表达了新想法、结论要点、候选方案或未想清的问题时，随回复一并调用。" +
      "九模块键（按需传，缺省保留原值）：anchor 需求锚点 / audience 受众画像 / proposition 价值主张（价值维）；modules 功能拆解 / skeleton 骨架识别 / boundaries 边界定义（结构维）；link 核心链路 / bottlenecks 依赖与瓶颈 / feedback 反馈闭环（路径维）。" +
      "调用前先自查分类是否准确；没想清的一律进 bottlenecks，不要脑补。",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "当前项目工作目录（必填，用于区分不同项目的骨架）" },
        goalTitle: { type: "string", description: "目标标题（≤20字）。仅当首次建立或用户明确改向时提供" },
        goal: { type: "string", description: "一句话目标描述（≤30字）。仅当首次建立或用户明确改向时提供" },
        anchor:      { type: "array", items: { type: "object", properties: { text: { type: "string", description: "需求锚点（≤30字）：触发场景/痛点" }, raw: { type: "string", description: "用户原话（可选，≤200字）" } }, required: ["text"] } },
        audience:    { type: "array", items: { type: "object", properties: { text: { type: "string", description: "受众画像（≤30字）：行为特征" } }, required: ["text"] } },
        proposition: { type: "array", items: { type: "object", properties: { text: { type: "string", description: "价值主张（≤30字）：通过__为__解决__" } }, required: ["text"] } },
        modules:     { type: "array", items: { type: "object", properties: { title: { type: "string", description: "功能拆解（≤25字）：模块名：一句话职责" }, paths: { type: "array", items: { type: "object", properties: { step: { type: "string" } } } } }, required: ["title"] } },
        skeleton:    { type: "array", items: { type: "object", properties: { title: { type: "string", description: "骨架识别（≤25字）：删掉就垮的核心模块" } }, required: ["title"] } },
        boundaries:  { type: "array", items: { type: "object", properties: { text: { type: "string", description: "边界定义（≤25字）：明确不做" } }, required: ["text"] } },
        link:        { type: "array", items: { type: "object", properties: { text: { type: "string", description: "核心链路一步（≤30字）：步骤名→输出" } }, required: ["text"] } },
        bottlenecks: { type: "array", items: { type: "object", properties: { text: { type: "string", description: "依赖与瓶颈（≤25字）：缺什么/卡在哪" } }, required: ["text"] } },
        feedback:    { type: "array", items: { type: "object", properties: { text: { type: "string", description: "反馈闭环（≤25字）：什么回流/触发什么调整" } }, required: ["text"] } },
      },
      required: ["cwd"],
    },
  },
  {
    name: "mind_board_control",
    description:
      "思维板宿主动作。需要用户新建/切换目标、归档任务时调用。动作：new-goal{title,goal?} | switch-goal{id} | archive{} | remove-item{dim,mod,id} 等。" +
      "重要：当 organize 返回 pendingNewTask 时，必须先询问用户确认，得到同意后调用本工具 new-goal 动作。",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "当前项目工作目录" },
        action: { type: "string", enum: ["new-goal", "switch-goal", "archive", "reopen", "remove-item"], description: "动作名" },
        params: { type: "object", description: "动作参数（如 id/title/dim/mod）" },
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
