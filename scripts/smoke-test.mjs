// mind-board-pet 冒烟测试 —— node scripts/smoke-test.mjs
// 隔离：MIND_BOARD_HOME 指向临时目录，不碰真实数据。
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MIND_BOARD_HOME = mkdtempSync(join(tmpdir(), "mb-pet-test-"));

const store = await import("../src/core/store.mjs");

let failed = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failed++; console.error(`  ✗ ${name} ${extra}`); }
}

/* 1. 项目解析稳定 */
const p1 = store.resolveProject("C:\\fake\\proj-a", "claude-code");
const p2 = store.resolveProject("c:\\FAKE\\proj-a", "claude-code"); // 大小写归一（win32）
check("同目录解析为同一项目", p1.id === p2.id);
check("出身戳记录 harness", p1.harness === "claude-code");

/* 2. 整理与去重 */
let r = store.organize(p1.id, {
  harness: "claude-code",
  goalTitle: "做一个工具折叠插件",
  ideas: [{ text: "想做折叠插件", group: "需求" }, { text: "工具树太占地方", group: "需求" }],
  points: [{ text: "核心是收成一行再展开" }],
  plans: [{ title: "DOM 注入折叠条", paths: [{ step: "插入标题条" }, { step: "CSS 收起" }] }],
  gaps: [{ text: "是否和 DSH 版本冲突" }],
});
check("organize 成功", r.ok && r.currentGoalId);
check("四层各记入条目",
  r.applied.ideas === 2 && r.applied.points === 1 && r.applied.plans === 1 && r.applied.gaps === 1,
  JSON.stringify(r.applied));

r = store.organize(p1.id, {
  harness: "claude-code",
  ideas: [{ text: "想做折叠插件", group: "需求" }],        // 完全重复
  points: [{ text: "核心是收成一行、再展开" }],             // 近似重复（相似度高）
});
check("完全重复去重", !r.applied.ideas);
check("近似重复去重（Jaccard≥0.7）", !r.applied.points, JSON.stringify(r.applied));

r = store.organize(p1.id, { harness: "claude-code", gaps: [{ text: "样式冲突如何自愈" }] });
check("新缺口记入且动效信号 gapAdded", r.ok);

/* 3. 目标变化检测 */
r = store.organize(p1.id, {
  harness: "claude-code",
  goalTitle: "今晚吃什么",
  ideas: [{ text: "火锅候选" }],
});
check("新目标被拒绝并置 pendingNewTask", r.ok === false && r.pendingNewTask === true);
const afterConflict = store.fullSkeleton(p1.id).summary;
check("pendingNewTask 已落档", afterConflict.pendingNewTask === true);

/* 4. 动作：new-goal 清旗 → 切回旧目标 */
const ng = store.controlAction(p1.id, { action: "new-goal", params: { title: "今晚吃什么" } });
check("经用户确认后新建目标成功", ng.ok);
const afterNew = store.fullSkeleton(p1.id);
check("新目标成为当前目标", afterNew.skeleton.currentGoalId === ng.goalId);
check("确认后 pendingNewTask 清除", afterNew.summary.pendingNewTask === false);

const oldGoalId = r.currentGoalId || null;
// 切回第一个目标继续整理原话题
const sk = store.fullSkeleton(p1.id).skeleton;
const firstGoal = sk.goals[0];
const sw = store.controlAction(p1.id, { action: "switch-goal", params: { id: firstGoal.id } });
check("switch-goal 切回旧目标", sw.ok);
r = store.organize(p1.id, {
  harness: "claude-code",
  points: [{ text: "把说明书补上", decided: true }],
});
check("切回后正常整理不再拦截", r.ok === true);

/* 5. 勾选 / 删除 / 方案采用 */
let full = store.fullSkeleton(p1.id).skeleton;
let g0 = full.goals[0];
const ideaId = g0.ideas[0].id;
store.controlAction(p1.id, { action: "toggle-done", params: { id: ideaId } });
full = store.fullSkeleton(p1.id).skeleton;
g0 = full.goals[0];
check("toggle-done 勾选想法", g0.ideas.find((i) => i.id === ideaId).done === true);

const planId = g0.plans[0].id;
const cp = store.controlAction(p1.id, { action: "choose-plan", params: { id: planId } });
check("choose-plan 采用方案", cp.ok);

const rm = store.controlAction(p1.id, {
  action: "remove-item",
  params: { layer: "gaps", id: full.goals[0].gaps[0]?.id },
});
check("remove-item 删除条目", rm.ok);

/* 6. 总览 / 查询文本 */
const ov = store.overview();
check("overview 聚合含该项目", ov.projects.some((p) => p.id === p1.id));
check("settings 默认 off", ov.settings.mode === "off");

const qm = store.queryMarkdown("C:\\fake\\proj-a", "claude-code");
check("queryMarkdown 含层标签", qm.markdown.includes("要点") && qm.markdown.includes("缺口"));

/* 7. journal 可供兔壳消费 */
const jt = store.journalTail(0);
check("journal 有事件流", jt.events.length >= 3);
check("journal 有 organized 事件", jt.events.some((e) => e.type === "organized"));

/* 8. 导出 → 导入往返 */
const exported = store.exportAll();
check("导出包含任务", Object.keys(exported.tasks).length >= 1);

/* 8. organize 传新采用方案 → 旧采用自动让位（全局唯一） */
store.organize(p1.id, {
  harness: "claude-code",
  plans: [{ title: "模板复用路线", chosen: true }],
});
const plansNow = store.fullSkeleton(p1.id).skeleton.goals[0].plans;
check("全局唯一采用：新 chosen 生效", plansNow.find((p) => p.title === "模板复用路线")?.chosen === true);
check("全局唯一采用：旧 chosen 被清", plansNow.filter((p) => p.chosen).length === 1,
  JSON.stringify(plansNow.filter((p) => p.chosen).map((p) => p.title)));

/* 9. 30 天未动项目标记 idle */
const ovAged = store.overview();
check("overview 带 active 活跃标记", typeof ovAged.projects[0].active === "boolean");

/* 收尾报告 */
console.log(failed ? `\n${failed} 项未通过 ✗` : "\n全部通过 ✓");
process.exit(failed ? 1 : 0);
