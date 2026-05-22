import { app, BrowserWindow, ipcMain, Tray, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const isDev = !app.isPackaged;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createTrayImage() {
  const trayIconPath = path.join(__dirname, "../src/assets/ashborn-tray.png");

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
    alwaysOnTop: false,
    maximizable: true,
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
    void mainWindow.loadURL("http://localhost:1420");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.on("app:hide-to-tray", () => {
  hideMainWindowToTray();
});

ipcMain.on("app:quit", () => {
  app.quit();
});

app.whenReady().then(() => {
  createWindow();
  createTray();
});

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
