const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ashborn", {
  hideToTray: () => ipcRenderer.send("app:hide-to-tray"),
  quit: () => ipcRenderer.send("app:quit"),
  newestBackup: () => ipcRenderer.invoke("backup:newest"),
  writeBackup: (json: string) => ipcRenderer.invoke("backup:write", json),
});
