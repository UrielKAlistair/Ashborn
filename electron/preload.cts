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
  takeCaptureAtStart: () => ipcRenderer.invoke("app:take-capture"),
  setNow: (step: { id: string; title: string; endsAt: number | null; canTick: boolean } | null) => ipcRenderer.send("now:update", step),
  onNowDone: (listener: (id: string) => void) => {
    const handle = (_event: unknown, id: string) => listener(id);
    ipcRenderer.on("now:done", handle);
    return () => ipcRenderer.removeListener("now:done", handle);
  },
  onNowTimer: (listener: (id: string, start: boolean) => void) => {
    const handle = (_event: unknown, id: string, start: boolean) => listener(id, start);
    ipcRenderer.on("now:timer", handle);
    return () => ipcRenderer.removeListener("now:timer", handle);
  },
  newestBackup: () => ipcRenderer.invoke("backup:newest"),
  setUnsaved: (what: string | null) => ipcRenderer.send("app:unsaved", what),
  onSaveForQuit: (save: () => Promise<boolean>) => {
    // A save that throws answers false, so main is never left waiting; `request` says which ask it answers
    const handle = async (_event: unknown, request: number) => ipcRenderer.send("app:saved-for-quit", await save().catch(() => false), request);
    ipcRenderer.on("app:save-for-quit", handle);
    return () => ipcRenderer.removeListener("app:save-for-quit", handle);
  },
  writeBackup: (json: string) => ipcRenderer.invoke("backup:write", json),
});
