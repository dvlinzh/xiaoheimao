# 小黑猫 C# 壳（shell-win）

替代 Electron 的原生壳。Windows 11 自带运行库（.NET Framework 4.x + WebView2 运行时），成品单 exe。

## 构建

```bat
fetch-deps.bat   :: 一次性：下载 Roslyn 编译器 + WebView2 程序集（~50MB，仅开发侧）
build.bat        :: 产出 PetCat.exe
PetCat.exe       :: 运行（自动拉起数据服务：复用 13134 或启动 node src/server/app.mjs）
```

## 架构

| 部件 | 实现 | 内存语义 |
|---|---|---|
| 猫（PetCat.cs） | Win32 分层窗口，逐像素 alpha，alpha=0 天然穿透 | 常驻 ~45MB |
| 面板/设置/仪表盘（Shell.cs） | WebView2 按需窗播现有网页，圆角 SetWindowRgn | 关掉即释放 |
| dock 圆环 | 待做（M2 剩余）：原生 GDI+ 画 | — |
| 数据服务 | Node `src/server/app.mjs`（不动） | ~40MB 常驻 |

页面桥：向 WebView2 注入 `petBridge`/`bubbleBridge` 垫片（与 Electron `preload.cjs` 同语义），
页面代码零修改。WebView2 注入 `--disable-features=CalculateNativeWinOcclusion` 反幽灵参数。

## 与 Electron 版对照

| 能力 | Electron | C# 壳 |
|---|---|---|
| 常驻内存 | ~350MB | ~45MB（+面板按需） |
| 猫尺寸/脚底对齐/呼吸 | canvas 520×516 @0.42 | 同参数复刻 |
| 透明异形+穿透 | setShape 迂回 | 分层窗原生 |
| 幽灵可见 | forceRepaint 防御 | 猫窗无此问题类；WebView2 注入反 occlusion 参数 |
| 面板 | 常驻窗体 hide/show | 按需创建，关掉销毁 |

## 待做

- dock 圆环（原生画，轮询 /api/overview）
- 睡眠姿态/久坐提醒、journal 动效联动
- 热键（RegisterHotKey）、整理模式开关进菜单
- 打包分发（PetCat.exe + assets/，或单文件发布）
