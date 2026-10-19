const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ashborn", {
  hideToTray: () => ipcRenderer.send("app:hide-to-tray"),
  quit: () => ipcRenderer.send("app:quit"),
});
