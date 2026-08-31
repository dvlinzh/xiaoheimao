// mind-board-pet — MCP 工具 schema（独立文件）
// 单独成文件的原因：DSH Cordis 壳（src/dsh/index.js）要复用同一份契约，
// 若从 server.mjs 导入会顺带执行其顶层 stdio 监听，污染宿主进程的 stdin/stdout。
export const TOOLS = [
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
