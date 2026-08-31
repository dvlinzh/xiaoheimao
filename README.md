# 思维板 · 小黑猫（mind-board-pet）

一只蹲在屏幕边上的小黑猫，同时看管多个 AI 工具（harness）的思维板。
概念移植自 [dsh-mind-board](https://github.com/dvlinzh/DeepSeek-harness-mindboard)，重定位为**跨 harness 共享的桌宠中控**。

## 它是什么

- **数据中枢**：所有 AI 工具把想法整理进同一个地方 `~/.mind-board/`，四层骨架（想法 / 缺口 / 方案 / 要点）
- **MCP 工具**：任何支持 MCP 的 harness（Claude Code、Codex、Gemini CLI…）都能调用 `mind_board_organize` 写入
- **协议注入**：CC 会话启动时自动注入整理规则；每轮对话注入一行状态提醒（缺口数、当前目标）
- **小黑猫**：贴在屏幕右缘/任务栏待机，单击弹出 harness 图标环（以猫头为圆心的 120° 扇形），点击芯片打开思维面板；新增缺口时动效提醒

## 安装（把这段话发给你的 agent，一键完成）

```text
请帮我安装并启动「思维板·小黑猫」插件（https://github.com/dvlinzh/xiaoheimao）：

1. git clone https://github.com/dvlinzh/xiaoheimao.git 到本机任意目录（如 ~/mind-board-pet）
2. cd 进去后执行：npm install（Node.js ≥ 18，无需 Electron——原生壳仅 58KB）
3. 构建并启动：npm run build:shell && npm start
   （屏幕上的小黑猫 + 图标环 + 思维面板，全部由 C# 原生壳 + WebView2 承载）
4. 接入 Claude Code（本仓库已自带配置，零改动）：用 Claude Code 打开这个目录，
   首次会提示批准 .mcp.json 里的 mind-board 服务器（三个工具：
   organize/query/control），批准后 SessionStart / UserPromptSubmit 两个钩子
   自动随 .claude/settings.local.json 生效，开始对话即自动整理
   注意：钩子与 MCP 受「整理模式」开关控制，右键猫 → 设置窗 可切换
5. 验证：正常聊几句话后，点屏幕上的猫 → 头顶图标环 → 点芯片打开思维面板，
   能看到本轮对话整理出的目标/想法/要点/缺口
6. （可选）DSH 集成：在 DSH 安装脚本 src/dsh/index.js 对应入口的 Cordis
   挂载方式见仓库 README「接入 DSH」节；或直接把本目录交给 DSH 宿主按
   junction + cordis.patch.yml 方式注册

装完告诉我结果，有问题把报错发我。
```

> 需要 Node.js ≥ 18（[nodejs.org](https://nodejs.org) LTS）。数据存于 `~/.mind-board/`，
> 全程本地；删掉目录即清空，拷走目录即完整迁移。

## 接入 Claude Code（已在本仓库配置）

1. `.mcp.json` 已注册 `mind-board` 服务器（organize/control/query 三工具），首次使用时批准即可
2. `.claude/settings.local.json` 已挂两个钩子：
   - **SessionStart**：注入全量思维板协议（compaction 后自动重新注入）
   - **UserPromptSubmit**：每轮注入一行状态（目标 · 各层计数 · 未解缺口）
3. 钩子和 MCP 受「整理模式」开关控制——右键猫 → 设置窗可切换

## 接入 DSH（多入口设计：一份数据核心，四个接入壳）

```
入口 A  MCP stdio（任何 harness）       src/mcp/server.mjs
入口 B  Claude Code 钩子               src/hooks/*.mjs
入口 C  C# 原生壳（猫+面板）        shell-win/PetCat.cs
入口 D  DSH Cordis 插件壳              src/dsh/index.js   ← DSH 生态用这个
```

四个入口共用同一份 `~/.mind-board` 数据与同一套 store 原子写盘；DSH 会话自动建 `t_` 任务，
与 Claude Code 侧的目录项目（`p_`）在同一数据根互不冲突。

**方式一：Cordis 插件壳（推荐，DSH 原生体验）**

```powershell
.\scripts\install-dsh.ps1        # junction ×2 + cordis.patch.yml 注册，然后完全重启 DSH
```

装完在 DSH 输入框右侧点**脑图标**开启整理模式（entry D 的开关门禁）。喊「喵喵喵」可唤起桌面猫。

> ⚠️ 与原有 `dsh-mind-board` 插件**二选一**：两者行为都是整理注入，双装会双份提醒。
> 安装脚本会检查并提示。

**方式二：MCP 注册**（DSH 若支持外部 MCP server 配置）

```jsonc
{ "command": "node", "args": ["<本仓库>/src/mcp/server.mjs"], "env": { "MIND_BOARD_HARNESS": "dsh" } }
```

agent 引导需在 DSH 侧补充（没有 CC 那样现成的钩子）；数据写入与面板展示照常可用。

## 目录结构

```
mind-board-pet/
├── index.html               产品主页（GitHub Pages 可用）
├── .mcp.json                MCP 服务器注册
├── .claude/settings.local.json  钩子挂载
├── src/
│   ├── core/store.mjs       数据中枢：骨架合并/去重/目标变化检测/动作系统
│   ├── core/protocol.mjs    注入给 agent 的协议文本
│   ├── mcp/server.mjs       MCP stdio 服务器（三个工具）
│   ├── hooks/*.mjs          SessionStart / UserPromptSubmit 钩子脚本
│   ├── server/app.mjs       本地 HTTP 服务 127.0.0.1:13134（API + 页面）
│   ├── shell-win/           C# 原生壳（PetCat 猫窗 / DockRing 圆环 / WebView2 面板）
│   ├── renderer/pet.*       猫页（透明 + 逐像素命中，WebView2/Electron 通用）
│   ├── renderer/dock.*      harness 图标环页（120° 扇形，以猫头为圆心）
│   ├── renderer/bubble.*    思维板面板（四层骨架可视化，可拖拽删除/归档）
│   └── renderer/docs/       技术图解与标定工具（ring-calibrator.html 等）
└── scripts/smoke-test.mjs   冒烟测试
```

## 行为约束（写死在中枢里）

- 同层文本去重（精确或相似度 ≥ 0.7 视为同一条，更新而非新增）
- 疑似换目标（新旧 goal 相似度 < 0.25 且骨架非空）：拒绝写入并置 `pendingNewTask`，agent 必须先问用户
- 所有写盘走临时文件原子替换；每次变更追加 `journal.jsonl` 供桌宠动效消费

## 已知边界

- 协议注入是软约束，模型偶尔偷懒不调工具属正常；状态行每轮都在，会持续被拉回
- 全屏独占游戏会盖住桌宠（系统限制）；无边框窗口模式不受影响
