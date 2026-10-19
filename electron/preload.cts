const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ashborn", {
  hideToTray: () => ipcRenderer.send("app:hide-to-tray"),
  quit: () => ipcRenderer.send("app:quit"),
  call: (name: string, ...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args),
});
