import { app, BrowserWindow, ipcMain, Tray, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { api } from "./api.js";

const isDev = !app.isPackaged;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function resolveAppPath(...segments: string[]) {
  return path.join(app.getAppPath(), ...segments);
}

function createTrayImage() {
  const trayIconPath = resolveAppPath("src", "assets", "ashborn-tray.png");

  if (!fs.existsSync(trayIconPath)) {
    throw new Error(`Tray icon not found at ${trayIconPath}`);
  }

  return nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
}

function handleTrayActivation() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    hideMainWindowToTray();
    return;
  }

  showMainWindow();
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip("Ashborn");

  tray.on("click", () => {
    handleTrayActivation();
  });

  tray.on("double-click", () => {
    handleTrayActivation();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    autoHideMenuBar: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.maximize();

  if (isDev) {
    void mainWindow.loadURL("http://127.0.0.1:1420");
  } else {
    void mainWindow.loadFile(resolveAppPath("dist", "index.html"));
  }
}

ipcMain.on("app:hide-to-tray", () => {
  hideMainWindowToTray();
});

ipcMain.on("app:quit", () => {
  app.quit();
});

// Each api method is exposed as the IPC channel "api:<name>"
for (const [name, method] of Object.entries(api)) {
  ipcMain.handle(`api:${name}`, (_event, ...args: unknown[]) =>
    (method as (...methodArgs: unknown[]) => unknown)(...args),
  );
}

// A second launch focuses the running window instead of opening another window and tray icon
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.whenReady().then(() => {
    createWindow();
    createTray();
  });
}

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
    return;
  }

  showMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
