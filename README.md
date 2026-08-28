# 思维板 · 小兔（mind-board-pet）v0.1

一只蹲在屏幕右缘的电子兔，同时看管多个 AI 工具（harness）的思维板。
概念移植自 [dsh-mind-board](https://github.com/dvlinzh/DeepSeek-harness-mindboard)（原 Anthropic 黑客松项目 Maieutic 的 DSH 移植版），重定位为**跨 harness 共享的桌宠中控**。

## 它是什么

- **数据中枢**：所有 AI 工具把想法整理进同一个地方 `~/.mind-board/`，四层骨架（目标 / 想法 / 要点 / 方案 / 缺口）
- **MCP 工具**：任何支持 MCP 的 harness（Claude Code、Codex、Gemini CLI…）都能调用 `mind_board_organize` 写入
- **协议注入**：CC 会话启动时自动注入整理规则；每轮对话注入一行状态提醒（缺口数、当前目标）
- **电子兔**：贴边待机、悬停吐出各 harness 图标（带缺口角标）、点击弹出漫画对话框面板；新增缺口时竖耳警告

## 目录结构

```
mind-board-pet/
├── src/
│   ├── core/store.mjs        数据中枢：骨架合并/去重/目标变化检测/动作系统
│   ├── core/protocol.mjs     注入给 agent 的协议文本
│   ├── mcp/server.mjs        MCP stdio 服务器（三个工具）
│   ├── hooks/*.mjs           SessionStart / UserPromptSubmit 钩子脚本
│   ├── server/app.mjs        本地 HTTP 服务 127.0.0.1:13134（API + 页面）
│   ├── renderer/pet.*        兔子页（透明窗口）
│   ├── renderer/bubble.*     漫画气泡面板
│   └── main/main.js          Electron 主进程（透明窗、气泡窗、热键 Ctrl+Alt+B）
└── scripts/smoke-test.mjs    冒烟测试（23 项）
```

## 启动方式

```bash
# 1) 电子兔（推荐首次体验用演示数据源见下）
cd mind-board-pet && npm start
```

- **浏览器模式**（Electron 跑不起来时的兜底）：`node src/server/app.mjs` 后浏览器开 `http://127.0.0.1:13134/pet.html`
- **演示数据**：先跑一次 `node scripts/start-demo.mjs` 再看页面，内置「工具折叠插件」「多城市清补串」两个示例项目。要切真实数据，直接 `npm start`

## 接入 Claude Code（已在本仓库配置）

1. `.mcp.json` 已注册 `mind-board` 服务器（organize/control/query 三工具），首次使用时批准即可
2. `.claude/settings.local.json` 已挂两个钩子：
   - **SessionStart**：注入全量思维板协议（compaction 后自动重新注入）
   - **UserPromptSubmit**：每轮注入一行状态（目标 · 各层计数 · 未解缺口；pendingNewTask 时强提醒先问用户）
3. 钩子和 MCP 受「整理模式」开关控制——兔子右键菜单可切换，或点气泡面板左上角圆点

## 接入其他 harness（P3 待做）

同样的 server 命令注册到 Codex / Gemini CLI 的 MCP 配置即可，共用同一份 `~/.mind-board/`。

## 行为约束（写死在中枢里的）

- 同层文本去重（精确或相似度 ≥ 0.7 视为同一条，更新而非新增）
- 疑似换目标（新旧 goal 相似度 < 0.25 且骨架非空）：拒绝写入并置 `pendingNewTask`，agent 必须先问用户
- 所有写盘走临时文件原子替换；每次变更追加 `journal.jsonl` 供兔子动效消费

## 已知边界

- 协议注入是软约束，模型偶尔偷懒不调工具属正常；状态行每轮都在，会持续被拉回
- 兔窗位置暂不持久化（每次居中贴右缘）；热键 Ctrl+Alt+B 呼出/收起最近气泡
