const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ashborn", {
  hideToTray: () => ipcRenderer.send("app:hide-to-tray"),
  quit: () => ipcRenderer.send("app:quit"),
  getGameSnapshot: () => ipcRenderer.invoke("game:get-snapshot"),
  getHomeSnapshot: () => ipcRenderer.invoke("home:get-snapshot"),
  toggleTaskInstance: (instanceId: string) =>
    ipcRenderer.invoke("game:toggle-task-instance", instanceId),
  toggleHomeTaskInstance: (instanceId: string) =>
    ipcRenderer.invoke("home:toggle-task-instance", instanceId),
  saveDashboardWidgets: (widgets: unknown) =>
    ipcRenderer.invoke("game:save-dashboard-widgets", widgets),
});
