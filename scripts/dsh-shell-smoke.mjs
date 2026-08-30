// mind-board-pet — DSH Cordis 壳冒烟测试（无宿主也能跑）
// 伪造 ctx（tools/on/webServer/logger）→ apply() → 驱动事件断言行为：
//   1. 三个工具注册成功（organize/control/query，schema 里 cwd→projectId）
//   2. user/message → t_ 任务自动创建 + 计数
//   3. agent/pre-step → 注入协议/状态行（含 projectId）
//   4. execute organize → 骨架写盘
//   5. mode off → 零注入
// 数据隔离：MIND_BOARD_HOME 指向临时目录，跑完清理。
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "mb-dsh-smoke-"));
process.env.MIND_BOARD_HOME = HOME;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗ FAIL:", msg); } };

const registered = [];
const handlers = {};
const routes = [];
const fakeCtx = {
  get: (k) => (k === "tools" ? { register: (t) => registered.push(t) } : null),
  on: (name, fn) => { handlers[name] = fn; },
  webServer: { register: (c) => { routes.push(c); return () => {}; } },
  logger: { warn: () => {} },
};

const mod = await import("../src/dsh/index.js");
const dispose = mod.apply(fakeCtx);
// 模拟用户在 DSH 点「脑图标」启用（全新数据目录 mode 默认 off 是刻意的静默语义）
mod.store.writeSettings({ mode: "on" });

/* 1. 工具注册 */
ok(registered.length === 3, `注册 3 个工具（实际 ${registered.length}）`);
const org = registered.find((t) => t.name === "mind_board_organize");
const qry = registered.find((t) => t.name === "mind_board_query");
const ctl = registered.find((t) => t.name === "mind_board_control");
ok(!!org && !!qry && !!ctl, "organize/query/control 均在");
ok(org.parameters.properties?.projectId && !org.parameters.properties?.cwd, "organize schema：cwd→projectId");

/* 2. user/message → 任务创建 */
const session = { id: "smoke-sess-1" };
const mkMsg = (text) => ({
  type: "user/message",
  data: { source: { kind: "user" }, content: text },
});
handlers["session/event"](session, mkMsg("我们要做一个跨 harness 的思维整理面板"));
const recs = mod.store.allRecords().filter((r) => r.sessionId === "smoke-sess-1");
ok(recs.length === 1, `首条消息自动建任务（${recs.length}）`);
const taskId = recs[0]?.id || "";
ok(/^t_/.test(taskId), `任务 id 为 t_ 前缀（${taskId}）`);

/* 3. pre-step 注入（模拟 decision 消息列表） */
const preFn = handlers["agent/pre-step"];
const pushMsg = { id: "m1", role: "user", content: [{ type: "text", text: "继续" }] };
const decision = { kind: "enter", messages: [pushMsg, { id: "m2", role: "assistant", content: [{ type: "text", text: "..." }] }] };
const out = await preFn({ agent: { session }, messages: [pushMsg], step: 1, signal: null }, async () => decision);
const injectedTexts = (out.messages || []).filter((m) => m.source?.plugin === "mind-board-pet")
  .map((m) => m.content[0].text);
ok(injectedTexts.length >= 1, `pre-step 注入 ≥1 条（${injectedTexts.length}）`);
ok(injectedTexts.some((t) => t.includes("思维板协议") || t.includes("当前任务")), "注入含协议/状态行");
ok(injectedTexts.some((t) => t.includes("projectId=「" + taskId + "」")), "注入含 projectId");

/* 4. organize 工具执行 → 骨架写盘 */
const orgRes = await org.execute({ projectId: taskId, goal: "多入口思维面板", ideas: [{ text: "一个想法" }], gaps: [{ text: "还缺验证" }] });
ok(orgRes.ok === true, `organize 执行成功（${JSON.stringify(orgRes).slice(0, 60)}）`);
ok(existsSync(join(HOME, "skeletons", taskId + ".json")), "骨架文件已写盘");
const qryRes = await qry.execute({ projectId: taskId });
ok(qryRes.ok && qryRes.text.includes("一个想法"), "query 返回骨架文本");

/* 5. mode off → 静默 */
mod.store.writeSettings({ mode: "off" });
const offDecision = { kind: "enter", messages: [pushMsg] };
const off = await preFn({ agent: { session }, messages: [pushMsg], step: 2, signal: null }, async () => offDecision);
const offInjected = (off.messages || []).filter((m) => m.source?.plugin === "mind-board-pet");
ok(offInjected.length === 0, "mode off：零注入");

dispose();
rmSync(HOME, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "全部通过 ✓" : `${fail} 项失败 ✗`}（${pass} 项）`);
process.exit(fail === 0 ? 0 : 1);
