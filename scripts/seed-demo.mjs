// 种子演示数据（scripts/seed-demo.mjs）
// 用法：node scripts/seed-demo.mjs [port]
const port = process.argv[2] || 13134;
const post = (path, body) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

await post("/api/mode", { mode: "on" });

const r1 = await post("/api/organize", {
  cwd: "C:/demo/tool-collapse",
  harness: "claude-code",
  goalTitle: "做一个工具折叠插件",
  ideas: [
    { text: "想做折叠插件，收起工具调用树", group: "需求" },
    { text: "树太占地方，一屏只能看三行", group: "需求" },
  ],
  points: [
    { text: "核心是收成一行、点开展开" },
    { text: "不能破坏现有渲染管线", decided: true },
  ],
  plans: [
    { title: "DOM 注入折叠条", chosen: true, paths: [{ step: "插入标题条" }, { step: "CSS 收起子树" }, { step: "MutationObserver 自愈" }] },
    { title: "完整复刻工具树", dismissed: true },
  ],
  gaps: [
    { text: "是否与新版工具卡片样式冲突" },
    { text: "折叠状态要不要持久化" },
  ],
});
console.log("claude-code:", JSON.stringify(r1));

const r2 = await post("/api/organize", {
  cwd: "C:/demo/city-seo",
  harness: "dsh",
  goalTitle: "多城市清补串交付",
  ideas: [
    { text: "批量生成城市落地页串", group: "方案" },
    { text: "交付时附 md 文件卡片", group: "需求" },
  ],
  points: [{ text: "每城一表一文件，编号对齐" }],
  plans: [{ title: "模板复用 + 城市参数注入" }],
  gaps: [{ text: "城市名生僻字字体覆盖？" }],
});
console.log("dsh:", JSON.stringify(r2));
