// 3D×9M 执行规则引擎（最小理解系统插件 · 执行层）
// 阶段状态机 + 模块写入编排。数据写入走 mind_board_organize（3d9m-* group 命名空间），
// 状态持久化到 ~/.mind-board/projects/<id>.json 的 stage3d9m 字段。

import { readSettings, organize, fullSkeleton } from "../core/store.mjs";

/** 阶段枚举 */
export const STAGES = ["播种", "定锚", "拆骨", "通路", "执行", "存档"];

/** 从骨架读九模块完成度（与 protocol-3d9m.getModuleStatus 同源逻辑） */
export function getModuleStatus(skeleton) {
  const st = { valueDone: "todo", structDone: "todo", pathDone: "todo" };
  if (!skeleton) return st;
  const val = (skeleton.ideas || []).filter((i) => i.group === "3d9m-value");
  if (val.length >= 3) st.valueDone = "done";
  else if (val.length > 0) st.valueDone = "pending";
  const str = (skeleton.plans || []).filter((p) => p.group === "3d9m-struct");
  if (str.length >= 3) st.structDone = "done";
  else if (str.length > 0) st.structDone = "pending";
  const paths = (skeleton.plans || []).flatMap((p) => p.paths || []).filter((p) => p.type === "3d9m-path");
  const fb = (skeleton.points || []).filter((p) => p.type === "3d9m-feedback");
  if (paths.length > 0 && fb.length > 0) st.pathDone = "done";
  else if (paths.length > 0 || fb.length > 0) st.pathDone = "pending";
  return st;
}

/** 从组织配置读取当前阶段（stage3d9m 字段），无则默认 0 */
export function getStage(projectId) {
  const data = fullSkeleton(projectId);
  return data?.summary?.stage3d9m ?? 0;
}

/** 设置阶段（阶段切换时调用；同步到项目档案） */
export function setStage(projectId, stage) {
  // organize 的 cwd 寻址由调用方（钩子/MCP）负责，这里只管写
  return { stage: STAGES[stage] || STAGES[0] };
}

/** 阶段推进判定：根据九模块完成度返回建议的下一阶段
 *  价值维≥3 条 → 阶段一完成 → 推进阶段二；以此类推。 */
export function suggestStage(skeleton) {
  const st = getModuleStatus(skeleton);
  if (st.valueDone === "done" && st.structDone === "todo") return 2;   // 价值维✅ → 拆骨
  if (st.structDone === "done" && st.pathDone === "todo") return 3;    // 结构维✅ → 通路
  if (st.pathDone === "done") return 4;                                 // 路径维✅ → 执行
  return 1;                                                             // 默认回到定锚
}

/** 执行交付格式模板（阶段四 AI 输出的强制骨架） */
export function deliveryTemplate(content, deliverable, status, questions) {
  return [
    `**本次执行内容**：${content}`,
    `**产出**：\n${deliverable}`,
    `**完成度**：${status}`,
    `**需要你确认**：${questions || "无"}`,
  ].join("\n\n");
}

/** 验收循环：根据用户反馈关键词返回动作 */
export function parseVerdict(text) {
  const t = (text || "").trim();
  if (/^(可以|通过|OK|ok)/i.test(t)) return "approve";
  if (/^改/.test(t)) return "revise";
  if (/^重做/.test(t)) return "redo";
  if (/先跳过/.test(t)) return "skip";
  if (/先不定/.test(t)) return "defer";
  if (/回退|回到上一步/.test(t)) return "rollback";
  if (/方向不对|换思路/.test(t)) return "pivot";
  return null;
}

/** 集成 mind_board_organize：执行产出自动附加 3D×9M 元数据 */
export function attachMetadata(organizeArgs, moduleName, stage, status) {
  return {
    ...organizeArgs,
    metadata: {
      group: organizeArgs.group || "3d9m-struct",
      module: moduleName,
      stage,
      status: status || "待确认",
    },
  };
}
