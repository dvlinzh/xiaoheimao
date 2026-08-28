// 演示模式启动器 —— 固定使用 ~/.mind-board-demo 数据目录，供预览/验收
import { homedir } from "node:os";
import { join } from "node:path";

process.env.MIND_BOARD_HOME = join(homedir(), ".mind-board-demo");
// 演示服务固定用 13136，与真实兔子(13134)隔离，防止端口串台
process.env.MIND_BOARD_PORT = "13136";

const { startServer } = await import("../src/server/app.mjs");
const r = await startServer();
console.log(`[mind-board-pet|demo] http://127.0.0.1:${r.port}/pet.html`);
// 保持进程常驻（演示服务需要一直在线）
setInterval(() => {}, 1 << 30);
