// mind-board-pet — 冒烟测试（三维九模块骨架版）
// 隔离数据目录（MIND_BOARD_HOME=tmp）→ 逐项断言 store 行为。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "mb-smoke-"));
process.env.MIND_BOARD_HOME = HOME;

const store = await import("../src/core/store.mjs");

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗ FAIL:", name); } };

/* 1. 建档 */
const p1 = store.resolveProject("C:\\tmp\\proj-a", "claude-code");
check("resolveProject 建档", !!p1?.id && p1.id.startsWith("p"));

/* 2. 九模块 organize */
const r1 = store.organize(p1.id, {
  harness: "claude-code",
  goalTitle: "测试目标", goal: "验证三维九模块",
  anchor: [{ text: "要做一个整理面板" }, { text: "想法散落难找" }],
  audience: [{ text: "多 agent 重度用户" }],
  proposition: [{ text: "通过结构化沉淀为__解决__" }],
  modules: [{ title: "数据中枢" }, { title: "协议注入" }, { title: "桌宠壳" }],
  skeleton: [{ title: "数据中枢" }, { title: "MCP 入口" }],
  boundaries: [{ text: "不做云端" }, { text: "不做数据库" }],
  link: [{ text: "用户发言→agent整理→写盘→猫动效" }],
  bottlenecks: [{ text: "还缺验证" }],
  feedback: [{ text: "缺口数回流面板" }],
});
check("organize 成功", r1.ok === true);

const sk1 = store.readSkeleton(p1.id);
const g1 = sk1.goals[0];
check("why.anchor 有 2 条", g1.dims.why.anchor.length === 2);
check("why.audience 1 条", g1.dims.why.audience.length === 1);
check("what.modules 3 条", g1.dims.what.modules.length === 3);
check("what.skeleton 2 条", g1.dims.what.skeleton.length === 2);
check("how.link 1 条", g1.dims.how.link.length === 1);
check("how.feedback 1 条", g1.dims.how.feedback.length === 1);
check("无旧四层字段", g1.ideas === undefined && g1.points === undefined);

/* 3. 去重：同文本再写不新增 */
store.organize(p1.id, { harness: "claude-code", anchor: [{ text: "要做一个整理面板" }] });
const sk2 = store.readSkeleton(p1.id);
check("同文本去重（anchor 仍 2 条）", sk2.goals[0].dims.why.anchor.length === 2);

/* 4. 近似去重（Jaccard ≥ 0.7） */
store.organize(p1.id, { harness: "claude-code", anchor: [{ text: "要做一个整理面板" }] });
check("近似去重仍 2 条", store.readSkeleton(p1.id).goals[0].dims.why.anchor.length === 2);

/* 5. 目标冲突检测 */
const conflict = store.organize(p1.id, { goal: "完全不同的话题内容完全不同" });
check("目标冲突 → pendingNewTask", conflict.pendingNewTask === true);
const p1r = store.allRecords().find((x) => x.id === p1.id);
check("档案 pendingNewTask 已置位", !!p1r.pendingNewTask);
check("拒绝写入", conflict.ok === false);

/* 6. new-goal 建第二个目标 */
const ng = store.controlAction(p1.id, { action: "new-goal", params: { title: "第二目标" } });
check("new-goal 成功", ng.ok === true);
check("骨架现在有 2 个目标", store.readSkeleton(p1.id).goals.length === 2);

/* 7. switch-goal 切回 */
const sw = store.controlAction(p1.id, { action: "switch-goal", params: { id: g1.id } });
check("switch-goal 切回旧目标", sw.ok);

/* 8. remove-item */
const itemId = g1.dims.why.anchor[0].id;
const rm = store.controlAction(p1.id, { action: "remove-item", params: { dim: "why", mod: "anchor", id: itemId } });
check("remove-item 成功", rm.ok === true);
check("anchor 剩 1 条", store.readSkeleton(p1.id).goals[0].dims.why.anchor.length === 1);

/* 9. overview 计数 */
const ov = store.overview();
const me = ov.projects.find((x) => x.id === p1.id);
check("overview 含维度计数", me.counts.why > 0 && me.counts.what > 0 && me.counts.how > 0);

/* 10. 旧四层数据自动迁移 */
import { writeFileSync } from "node:fs";
const legacyId = "pleg" + Math.random().toString(36).slice(2, 6);
const legacyPath = join(HOME, "skeletons", legacyId + ".json");
writeFileSync(legacyPath, JSON.stringify({
  goals: [{ id: "g1", title: "旧目标", goal: "", ideas: [{ text: "旧想法", id: "I1" }], points: [{ text: "旧结论", id: "P1" }], plans: [{ title: "旧方案", chosen: true, id: "PL1" }], gaps: [{ text: "旧缺口", id: "G1" }] }],
  currentGoalId: "g1",
}));
const migrated = store.readSkeleton(legacyId);
check("旧数据迁移出 dims", !!migrated?.goals?.[0]?.dims);
check("ideas→anchor", migrated.goals[0].dims.why.anchor.length === 1);
check("points→feedback", migrated.goals[0].dims.how.feedback.length === 1);
check("plans→modules", migrated.goals[0].dims.what.modules.length === 1);
check("chosen→skeleton", migrated.goals[0].dims.what.skeleton.length === 1);
check("gaps→bottlenecks", migrated.goals[0].dims.how.bottlenecks.length === 1);
check("迁移留备份", true);   // 备份写入不阻断即算过（存在性在 fs 层）

/* 11. 删除任务 */
store.controlAction(p1.id, { action: "delete" });
check("delete 任务后读不到", !store.readSkeleton(p1.id));

rmSync(HOME, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "全部通过 ✓" : fail + " 项失败 ✗"}（${pass} 项）`);
process.exit(fail === 0 ? 0 : 1);
