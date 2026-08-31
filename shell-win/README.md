# 小黑猫 C# 壳（shell-win）

M1 原型：Win32 分层窗口桌宠，替代 Electron 壳。零下载零安装——编译器（csc.exe）和运行库（.NET Framework 4.x）都是 Windows 自带。

## 构建 & 运行

```bat
build.bat      :: 产出 PetCat.exe（同目录，单文件）
PetCat.exe     :: 双击运行
```

素材在构建时从 `src/renderer/assets/cat/` 复制（单一素材源）。

## 与 Electron 版的对应关系

| 能力 | Electron 版 | C# 版（本目录） |
|---|---|---|
| 透明异形窗 | 透明 BrowserWindow + setShape 迂回 | 分层窗口逐像素 alpha，原生 |
| 点击穿透 | 形态学膨胀 + 矩形栅格化上报 | alpha=0 处系统自动穿透 |
| 呼吸 | canvas rAF 60fps | 定时器 ~30fps（省一半电） |
| 拖拽 | 主进程跟随光标 | 窗内鼠标事件直接挪 |
| 面板/设置 | Electron 窗口 | 暂开浏览器（M2 换 WebView2 按需窗） |
| 幽灵可见 | 需 forceRepaint 防御 | 无此问题类（无浏览器合成器） |

## M1 范围 / 不在范围

在：显示、呼吸、拖拽换走姿、贴边回位、双击小跳、右键菜单、托盘找回。
不在（M2/M3）：dock 圆环、WebView2 面板窗、睡眠姿态、journal 动效联动、热键、自启动。
