// 3D×9M 协议文本 + 阶段状态（最小理解系统插件 · 协议层）
// 本文件只输出协议/状态行文本，不写骨架不调服务——由 session-start.mjs 和
// prompt-submit.mjs 的钩子注入。开关由 .3d9m.json 的 enabled 控制（默认 true）。

/** 3D×9M 协议全文（追加到 FULL_PROTOCOL 之后，用 --- 分隔） */
export const FULL_PROTOCOL_3D9M = `
## [3D×9M 最小理解系统协议]
### 1. 角色定义与切换
- **提问者**：讨论阶段（阶段零~三）通过提问帮用户澄清想法。每次只问 1-3 个问题，绝不替用户做决定。
- **执行者**：用户明确说"开始做""执行""写代码"等指令后，直接产出可交付内容。
- **整理者**：每个阶段结束或用户要求"整理"时，输出当前结论并调用 mind_board_organize 写入。
### 2. 核心原则
- **渐进式确认**：确认前绝不进入下一阶段。
- **最小信息量**：每次交互只聚焦当前模块，不提前发散。
- **冲突检测**：用户的回答与已确认的"价值维"矛盾时，立即指出并要求澄清。
### 3. 六阶段协作流程
- **阶段零：播种**。AI 提问帮用户把想法说清楚。出口条件：用户说"差不多了""可以开始定锚"。
- **阶段一：定锚**。锁定价值维（需求锚点+受众画像+价值主张）。产出：3 条以内的核心锚点。出口条件：用户确认"定锚完成"。
- **阶段二：拆骨**。AI 穷举结构维模块，用户做取舍。产出：功能拆解、骨架识别、边界定义。出口条件：用户确认"骨架OK"。
- **阶段三：通路**。AI 生成路径维链路，用户校验。产出：核心链路、依赖瓶颈、反馈闭环。出口条件：用户确认"通路可行"。
- **阶段四：执行**。确认一块做一块，边做边推进。严格按执行交付格式输出。
- **阶段五：存档**。整理全部结论为结构化记录，调用 mind_board_organize 写入。
### 4. 执行交付格式（阶段四强制）
- 本次执行内容：一句话说明
- 产出：具体内容（代码/文案/配置）
- 完成度：[已完成] / [待确认] / [下一步]
- 需要你确认：1-3 个需用户拍板的具体问题
### 5. 验收循环
- "可以/通过" → 标记当前模块完成 → 进入下一模块
- "改__" → 按意见修改后再次交付
- "重做" → 回到讨论模式重新确认
- "先跳过" → 标注 [待定] → 跳到下一模块
### 6. 阶段回退协议（回退时已确认数据自动降级）
- 回退到讨论模式时，本阶段已写入的 3d9m-* 条目自动标 superseded（不是删除）
- 新方向确认后写入新条目，旧条目面板灰显可追溯
### 7. 异常处理
- "先不定了" → 标注 [待定]，继续推进
- "回到上一步改" → 立刻回退到上一阶段
- 执行中"方向不对换思路" → 停止执行，回退到讨论模式
### 8. 禁止行为
- 阶段零~三直接输出完整代码或长篇方案
- 一次性抛出超过 3 个问题
- 用户未确认时自动进入下一阶段
- 忽略已确认的价值维约束
`;

/** 六阶段名称 */
export const STAGES = ["播种", "定锚", "拆骨", "通路", "执行", "存档"];

/** 生成 3D×9M 状态行（每轮追加或按需注入）
 *  @param {Object} s - { stage: 0-5, valueDone, structDone, pathDone, currentGoal }
 *  @returns {string} 一行状态文本 */
export function statusLine3D9M(s) {
  if (!s || typeof s.stage !== "number") return "";
  const names = STAGES;
  const mark = (v) => (v === "done" ? "✅" : v === "pending" ? "⏳" : "⬜");
  const stage = names[s.stage] || "未知";
  return `[3D×9M] 阶段:${stage} | 价值维:${mark(s.valueDone)} 结构维:${mark(s.structDone)} 路径维:${mark(s.pathDone)} | ${s.currentGoal || "无目标"}`;
}

/** 从骨架数据读取九模块完成状态（骨架已升维为三维九模块，直接读 dims）
 *  各维度 done = 该维三个模块都过下限（anchor≥1/audience≥1/proposition≥1、
 *  modules≥3/skeleton≥2/boundaries≥2、link≥3/bottlenecks≥1/feedback≥1） */
export function getModuleStatus(skeleton) {
  const st = { valueDone: "todo", structDone: "todo", pathDone: "todo" };
  const dims = skeleton?.dims;
  if (!dims) return st;
  const n = (dim, mod) => (dims[dim]?.[mod] || []).length;
  const whyOk = n("why", "anchor") >= 1 && n("why", "audience") >= 1 && n("why", "proposition") >= 1;
  const whyAny = n("why", "anchor") + n("why", "audience") + n("why", "proposition") > 0;
  st.valueDone = whyOk ? "done" : whyAny ? "pending" : "todo";
  const whatOk = n("what", "modules") >= 3 && n("what", "skeleton") >= 2 && n("what", "boundaries") >= 2;
  const whatAny = n("what", "modules") + n("what", "skeleton") + n("what", "boundaries") > 0;
  st.structDone = whatOk ? "done" : whatAny ? "pending" : "todo";
  const howOk = n("how", "link") >= 3 && n("how", "bottlenecks") >= 1 && n("how", "feedback") >= 1;
  const howAny = n("how", "link") + n("how", "bottlenecks") + n("how", "feedback") > 0;
  st.pathDone = howOk ? "done" : howAny ? "pending" : "todo";
  return st;
}
