const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ashborn", {
  hideToTray: () => ipcRenderer.send("app:hide-to-tray"),
  toggleMaximise: () => ipcRenderer.send("app:toggle-maximise"),
  isMaximised: () => ipcRenderer.invoke("app:is-maximised"),
  onMaximisedChange: (listener: (maximised: boolean) => void) => {
    const handle = (_event: unknown, maximised: boolean) => listener(maximised);
    ipcRenderer.on("app:maximised", handle);
    return () => ipcRenderer.removeListener("app:maximised", handle);
  },
  quit: () => ipcRenderer.send("app:quit"),
  onCapture: (listener: () => void) => {
    const handle = () => listener();
    ipcRenderer.on("app:capture", handle);
    return () => ipcRenderer.removeListener("app:capture", handle);
  },
  newestBackup: () => ipcRenderer.invoke("backup:newest"),
  writeBackup: (json: string) => ipcRenderer.invoke("backup:write", json),
});
