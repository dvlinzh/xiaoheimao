// mind-board-pet 启动器（C# 壳版）：拉起数据服务 + PetCat 原生壳
// 前置：shell-win/PetCat.exe 已构建（npm run build:shell；首次克隆按 README）
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "shell-win", "PetCat.exe");

if (!existsSync(exe)) {
  console.error("未找到 shell-win\\PetCat.exe。请先构建：npm run build:shell");
  process.exit(1);
}

// 1) 数据服务（PetCat 也会兜底拉起；这里先行启动并脱离父进程）
const svc = spawn(process.execPath, ["src/server/app.mjs"], {
  cwd: root, detached: true, stdio: "ignore",
});
svc.unref();
console.log("[start] 数据服务已启动 (127.0.0.1:13134)");

// 2) 原生壳（Win32 分层窗 + WebView2 面板）
const pet = spawn(exe, [], { cwd: join(root, "shell-win"), detached: true, stdio: "ignore" });
pet.unref();
console.log("[start] 小黑猫已启动（PetCat.exe）");
