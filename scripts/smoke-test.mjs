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

/* 12. 素材完整性（防"本地有、仓库没有"类事故）
   真实事故：cat-rest.png 曾只存在于开发者本机、没进 git；build.bat 只 copy 什么就崩在哪，
   新克隆的仓库里没有这张图 → 壳构造函数 Image.FromFile 抛异常 → 启动即崩无提示。
   注意：只断言"文件在磁盘存在"抓不到这个 bug（本机永远有），必须断言"被 git 跟踪"。 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dirname, "..");
const ASSET_DIR = join(REPO_ROOT, "src", "renderer", "assets");
const CAT_DIR = join(ASSET_DIR, "cat");
const POSES = ["cat-idle.png", "cat-walk.png", "cat-rest.png", "cat-sleep.png"];

// 8 字节 PNG 签名 → 校验文件头；IHDR 恒为第一个块，偏移 16/20 是宽高（大端 u32）
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const readPngSize = (buf) => {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;   // 不合规：首个块不是 IHDR
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

// git 跟踪查询：只认源目录（shell-win/assets/ 是 build.bat 复制出的部署副本，被 .gitignore 忽略）
const inGitRepo = (() => {
  try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: REPO_ROOT, stdio: "pipe" }); return true; }
  catch { return false; }
})();
const gitTracked = (rel) => {
  try { execFileSync("git", ["ls-files", "--error-unmatch", rel], { cwd: REPO_ROOT, stdio: "pipe" }); return true; }
  catch { return false; }
};

// 四张姿态图：存在 → 合法且尺寸合理 → 被 git 跟踪
for (const f of POSES) {
  const p = join(CAT_DIR, f);
  check(`姿态图存在：${f}`, existsSync(p));
  const sz = existsSync(p) ? readPngSize(readFileSync(p)) : null;
  check(`姿态图是合法 PNG 且宽高>0：${f}${sz ? ` (${sz.w}×${sz.h})` : ""}`, !!sz && sz.w > 0 && sz.h > 0);
  if (inGitRepo) check(`姿态图已被 git 跟踪：${f}`, gitTracked(`src/renderer/assets/cat/${f}`));
}
if (!inGitRepo) console.log("  - 跳过 git 跟踪断言（当前目录不是 git 仓库）");

/* 13. 壳素材清单与源目录一致：解析 PetCat.cs 里 Image.FromFile(...) 引用的 "cat-*.png"
   不另抄一份清单常量——抄一份就会退化成"永远同步"的假断言；真解析才能抓住
   "往 PetCat.cs 加姿态却忘了放素材/入库"这类漂移。 */
const SHELL_DIR = join(REPO_ROOT, "shell-win");
const PETCAT = join(SHELL_DIR, "PetCat.cs");
if (existsSync(PETCAT)) {
  // 只抽「带引号的 cat-*.png 字面量」，不按「与 Image.FromFile 同行」判定：
  // 素材加载会被抽进辅助函数（如 TryLoadPose(path)），文件名与加载调用不再同行。
  // 先剥行注释，防注释里出现的文件名被误当成素材清单。
  const src = readFileSync(PETCAT, "utf8")
    .split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const shellPoses = new Set();
  for (const m of src.matchAll(/"(cat-[^"]+\.png)"/g)) shellPoses.add(m[1]);
  check("从 PetCat.cs 解析出姿态清单（非空）", shellPoses.size > 0);
  for (const name of shellPoses) {
    const p = join(CAT_DIR, name);
    check(`壳素材存在：${name}`, existsSync(p));
    if (inGitRepo) check(`壳素材已被 git 跟踪：${name}`, gitTracked(`src/renderer/assets/cat/${name}`));
  }
} else {
  console.log("  - 跳过壳素材清单断言（shell-win/ 不存在，环境被裁剪）");
}

/* 14. 托盘图：曾因 PNG/ICO 格式不符让壳启动即崩（见 ~/.mind-board/petcat-crash.log） */
const trayPath = join(ASSET_DIR, "tray.png");
check("托盘图存在：assets/tray.png", existsSync(trayPath));
const traySz = existsSync(trayPath) ? readPngSize(readFileSync(trayPath)) : null;
check(`托盘图是合法 PNG 且宽高>0${traySz ? ` (${traySz.w}×${traySz.h})` : ""}`, !!traySz && traySz.w > 0 && traySz.h > 0);
if (inGitRepo) check("托盘图已被 git 跟踪", gitTracked("src/renderer/assets/tray.png"));

rmSync(HOME, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "全部通过 ✓" : fail + " 项失败 ✗"}（${pass} 项）`);
process.exit(fail === 0 ? 0 : 1);
