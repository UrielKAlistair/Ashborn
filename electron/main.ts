import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const isDev = !app.isPackaged;
// Started at login (see scripts/install-appimage.sh): only the tray icon until it is clicked
const startHidden = process.argv.includes("--hidden");
// Launched with --capture (GNOME can bind a key to that command): the capture field, ready for a thought
const startCapture = process.argv.includes("--capture");
// `npm run phone`: open straight in the phone view, for checking the phone layout
const startPhone = process.argv.includes("--phone");
// The phone view's window size: narrow enough for the phone layout (under 640 px wide)
const PHONE_VIEW_WIDTH = 400;
const PHONE_VIEW_HEIGHT = 860;
// The nightly backups the page writes (src/lib/backupSchedule.ts): one file a day, the newest kept.
// Tests point ASHBORN_BACKUP_DIR elsewhere, so their data stays out of the real backups.
const BACKUP_DIR = process.env.ASHBORN_BACKUP_DIR ?? path.join(os.homedir(), ".local", "share", "ashborn", "backups");
const BACKUPS_KEPT = 30;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// The step in the app's Now, mirrored in the tray so it can be seen and ticked without the window
type NowStep = { id: string; title: string; endsAt: number | null; canTick: boolean } | null;
let nowStep: NowStep = null;
// Set once the app is really quitting, so closing the window no longer just hides it
let quitting = false;

function resolveAppPath(...segments: string[]) {
  return path.join(app.getAppPath(), ...segments);
}

function createTrayImage() {
  const trayIconPath = resolveAppPath("src", "assets", "ashborn-tray.png");

  if (!fs.existsSync(trayIconPath)) {
    throw new Error(`Tray icon not found at ${trayIconPath}`);
  }

  return nativeImage.createFromPath(trayIconPath);
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
  updateTrayMenu();

  tray.on("click", () => {
    handleTrayActivation();
  });

  tray.on("double-click", () => {
    handleTrayActivation();
  });
}

// GNOME's AppIndicator extension sends a click only on a double-click; a single click opens this menu
function updateTrayMenu() {
  if (!tray) return;
  const now = nowStep;
  const title = now && now.title.length > 60 ? `${now.title.slice(0, 59)}…` : now?.title;
  const nowItems: Electron.MenuItemConstructorOptions[] = now
    ? [
        { label: `Now: ${title}`, click: showMainWindow },
        ...(now.endsAt ? [{ label: `Timer until ${new Date(now.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, enabled: false }] : []),
        ...(now.canTick
          ? [
              { label: "Done", click: () => mainWindow?.webContents.send("now:done", now.id) },
              now.endsAt
                ? { label: "Stop the timer", click: () => mainWindow?.webContents.send("now:timer", now.id, false) }
                : { label: "Start the timer", click: () => mainWindow?.webContents.send("now:timer", now.id, true) },
            ]
          : []),
        { type: "separator" },
      ]
    : [];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...nowItems,
      { label: "Capture a thought", click: captureThought },
      { label: "Show Ashborn", click: showMainWindow },
      { label: "Quit Ashborn", click: () => app.quit() },
    ]),
  );
  tray.setToolTip(now ? `Ashborn · Now: ${title}` : "Ashborn");
}

function captureThought() {
  showMainWindow();
  mainWindow?.webContents.send("app:capture");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    autoHideMenuBar: true,
    frame: false,
    show: !startHidden,
    backgroundColor: "#02040d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Minimising or closing the window (the desktop's shortcuts, as the window has no frame) hides it
  // to the tray, which also takes it out of the window switcher. Only Quit ends the app.
  mainWindow.on("minimize", hideMainWindowToTray);
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideMainWindowToTray();
  });

  // The page's maximise button shows the restore glyph while the window is maximised
  mainWindow.on("maximize", () => mainWindow?.webContents.send("app:maximised", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("app:maximised", false));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (startPhone) showPhoneView();
  else if (startHidden) mainWindow.once("show", () => mainWindow?.maximize());
  else mainWindow.maximize();

  // The window shows only the app. Links to the web (the Atlas's sources) open in the system
  // browser, so no other site is loaded with the preload's access to the desktop.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // Every file's origin is "null", so a file must also be the app's own page
    const [to, from] = [new URL(url), new URL(mainWindow!.webContents.getURL())];
    if (to.origin === from.origin && (to.protocol !== "file:" || to.pathname === from.pathname)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });

  // Ctrl+Shift+M switches between the full window and a phone-sized one, which the page lays
  // out as the phone app
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift || input.key.toLowerCase() !== "m") return;
    event.preventDefault();
    togglePhoneView();
  });

  if (isDev) {
    void mainWindow.loadURL("http://127.0.0.1:1420");
  } else {
    void mainWindow.loadFile(resolveAppPath("dist", "index.html"));
  }
}

function togglePhoneView() {
  if (!mainWindow) return;
  if (!mainWindow.isMaximized()) return mainWindow.maximize();
  mainWindow.unmaximize();
  showPhoneView();
}

function showPhoneView() {
  mainWindow?.setSize(PHONE_VIEW_WIDTH, PHONE_VIEW_HEIGHT);
  mainWindow?.center();
}

ipcMain.on("app:hide-to-tray", () => {
  hideMainWindowToTray();
});

ipcMain.on("app:toggle-maximise", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});

ipcMain.handle("app:is-maximised", () => mainWindow?.isMaximized() ?? false);

// A first launch with --capture: the page asks once it can take it, as a message sent on load is missed
let captureAtStart = startCapture;
ipcMain.handle("app:take-capture", () => {
  const take = captureAtStart;
  captureAtStart = false;
  return take;
});

ipcMain.on("now:update", (_event, step: NowStep) => {
  nowStep = step;
  updateTrayMenu();
});

ipcMain.on("app:quit", () => {
  app.quit();
});

ipcMain.handle("backup:newest", () => {
  const times = backupFiles().map((name) => fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs);
  return times.length > 0 ? Math.max(...times) : null;
});

// Writes today's backup (replacing one written earlier today), then drops all but the newest.
// The backups hold all the user's data, so only the user can read them.
ipcMain.handle("backup:write", (_event, json: string) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.chmodSync(BACKUP_DIR, 0o700);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const file = path.join(BACKUP_DIR, `${date}.json`);
  // Written whole beside it, then put in its place, so a crash mid-write leaves the last good one
  fs.writeFileSync(`${file}.partial`, json, { mode: 0o600 });
  fs.renameSync(`${file}.partial`, file);
  for (const name of backupFiles().sort().slice(0, -BACKUPS_KEPT)) fs.unlinkSync(path.join(BACKUP_DIR, name));
});

function backupFiles() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));
}

// A second launch focuses the running window instead of opening another window and tray icon
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch shows this one; with --capture, at the capture field. On a Wayland desktop that is
  // the dependable way to a desktop-wide key, since the key grab below hears keys only over X11 windows.
  app.on("second-instance", (_event, argv) => (argv.includes("--capture") ? captureThought() : showMainWindow()));
  app.whenReady().then(() => {
    createWindow();
    createTray();

    // From anywhere on the desktop: the window, with its capture field ready for a thought. A key
    // another app already holds is left to it.
    globalShortcut.register("CommandOrControl+Alt+Space", captureThought);
  });
}

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
    return;
  }

  showMainWindow();
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
