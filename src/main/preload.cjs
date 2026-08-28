// 兔窗 preload —— 桥：穿透切换 / 气泡 / 拖拽 / 设置 / 偏好推送
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petBridge", {
  setClickable: (c) => ipcRenderer.send("set-clickable", !!c),
  openBubble: (harness) => ipcRenderer.send("open-bubble", { harness }),
  closeBubble: () => ipcRenderer.send("close-bubble"),
  quit: () => ipcRenderer.send("quit"),
  hidePet: () => ipcRenderer.send("hide-pet"),
  showPet: () => ipcRenderer.send("show-pet"),
  toggleDock: () => ipcRenderer.send("dock-toggle"),
  hideDock: () => ipcRenderer.send("dock-hide"),
  toggleSettings: () => ipcRenderer.send("settings-toggle"),
  hideSettings: () => ipcRenderer.send("settings-hide"),
  dragStart: () => ipcRenderer.send("drag-start"),
  dragEnd: () => ipcRenderer.send("drag-end"),
  onDrag: (cb) => ipcRenderer.on("drag-state", (_e, v) => cb(v)),
  getState: () => ipcRenderer.invoke("get-state"),
  setPin: (v) => ipcRenderer.send("set-pin", !!v),
  setEdge: (v) => ipcRenderer.send("set-edge", v),
  setAutostart: (v) => ipcRenderer.send("set-autostart", !!v),
  setWinHeight: (h) => ipcRenderer.send("set-win-height", Number(h) || 0),
  openDataDir: () => ipcRenderer.send("open-data-dir"),
  onPrefs: (cb) => ipcRenderer.on("ui-prefs", (_e, p) => cb(p)),
});
