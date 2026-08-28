// 气泡窗 preload —— 图钉桥（常显开关状态上报主进程）
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bubbleBridge", {
  setPinned: (v) => ipcRenderer.send("bubble-pinned", !!v),
  resizeStart: (edge) => ipcRenderer.send("panel-resize-start", String(edge || "")),
  resizeEnd: () => ipcRenderer.send("panel-resize-end"),
});
