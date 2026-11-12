/**
 * The desktop shell: Electron's main process, which hosts the app's page in one frameless window and
 * keeps it alive in the tray.
 *
 * Its jobs, in the order this file tells them:
 * 1. One instance only: a second launch shows the first and exits.
 * 2. The window: maximised, or phone-sized for checking the phone layout. Closing or minimising it
 *    hides it to the tray; only Quit ends the app. It shows only the app's own page; links to the web
 *    open in the system browser.
 * 3. The tray: its menu names the step Now shows and opens the window.
 * 4. What the page asks of the desktop over IPC (see preload.cts): the window controls, Now's step for
 *    the tray, unsaved work, and the daily backups to disk.
 * 5. Quitting with unsaved work asks first: Save, Discard or Cancel.
 *
 * Flags: --hidden (started at login: tray only), --phone (`npm run phone`).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const isDev = !app.isPackaged;
// Started at login (see scripts/install-appimage.sh): only the tray icon until it is clicked
const startHidden = process.argv.includes("--hidden");
// `npm run phone`: open straight in the phone view, for checking the phone layout
const startPhone = process.argv.includes("--phone");
// The phone view's window size: narrow enough for the phone layout (under 640 px wide)
const PHONE_VIEW_WIDTH = 400;
const PHONE_VIEW_HEIGHT = 860;
// The daily backups the page writes (src/lib/backupSchedule.ts): one file a day, the newest
// BACKUPS_KEPT kept.
// Tests point ASHBORN_BACKUP_DIR elsewhere, so their data stays out of the real backups.
const BACKUP_DIR = process.env.ASHBORN_BACKUP_DIR ?? path.join(os.homedir(), ".local", "share", "ashborn", "backups");
const BACKUPS_KEPT = 30;
// How long Save at quit waits for the page to answer before the app stays open (a page reloading or
// crashed never answers): longer than a request's own timeout (15 s), so a slow save can finish
const SAVE_FOR_QUIT_MS = 30_000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// The step in the app's Now, named in the tray's menu
type NowStep = { id: string; title: string } | null;
let nowStep: NowStep = null;
// Set once the app is really quitting, so closing the window no longer just hides it
let quitting = false;
// Work the page holds unsaved (a recipe being edited), named for the question asked at quit; null when none
let unsaved: string | null = null;
let askingToQuit = false;
// Numbers each Save at quit, so a late answer to one given up on isn't taken for the next's
let saveRequest = 0;

// A second launch focuses the running window instead of opening another window and tray icon
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.whenReady().then(() => {
    listenToPage();
    createWindow();
    createTray();
  });
  app.on("before-quit", askIfUnsaved);
}

// --- The window ---

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
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // The page's maximise button shows the restore glyph while the window is maximised
  mainWindow.on("maximize", () => mainWindow?.webContents.send("app:maximised", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("app:maximised", false));

  if (startPhone) showPhoneView();
  else if (startHidden) mainWindow.once("show", () => mainWindow?.maximize());
  else mainWindow.maximize();

  keepToTheApp(mainWindow);

  // A page loaded afresh, or gone, holds no unsaved work and shows no Now step, whatever it said before
  const pageGone = () => {
    unsaved = null;
    nowStep = null;
    updateTrayMenu();
  };
  mainWindow.webContents.on("did-start-loading", pageGone);
  mainWindow.webContents.on("render-process-gone", pageGone);

  // Ctrl+Shift+M switches between the full window and a phone-sized one, which the page lays
  // out as the phone app
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift || input.key.toLowerCase() !== "m") return;
    event.preventDefault();
    togglePhoneView();
  });

  if (isDev) void mainWindow.loadURL("http://127.0.0.1:1420");
  else void mainWindow.loadFile(resolveAppPath("dist", "index.html"));
}

// The window shows only the app. Links to the web (the Atlas's sources) open in the system browser,
// so no other site is loaded with the preload's access to the desktop.
function keepToTheApp(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    // Every file's origin is "null", so a file must also be the app's own page
    // ("data:" and the like share that origin too)
    const [to, from] = [new URL(url), new URL(window.webContents.getURL())];
    if (to.protocol === from.protocol && to.origin === from.origin && (to.protocol !== "file:" || to.pathname === from.pathname)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
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

function resolveAppPath(...segments: string[]) {
  return path.join(app.getAppPath(), ...segments);
}

// --- The tray ---

function createTray() {
  const iconPath = resolveAppPath("src", "assets", "ashborn-tray.png");
  if (!fs.existsSync(iconPath)) throw new Error(`Tray icon not found at ${iconPath}`);
  tray = new Tray(nativeImage.createFromPath(iconPath));
  updateTrayMenu();
  // Activating the icon only ever opens the window: hiding it is the window's own close or minimise
  tray.on("click", showMainWindow);
}

// GNOME's AppIndicator extension activates the icon (the click above) on a double-click; a single click
// opens this menu
function updateTrayMenu() {
  if (!tray) return;
  const title = nowStep && nowStep.title.length > 60 ? `${nowStep.title.slice(0, 59)}…` : nowStep?.title;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(title ? [{ label: `Now: ${title}`, click: showMainWindow }, { type: "separator" as const }] : []),
      { label: "Show Ashborn", click: showMainWindow },
      { label: "Quit Ashborn", click: () => app.quit() },
    ]),
  );
  tray.setToolTip(title ? `Ashborn · Now: ${title}` : "Ashborn");
}

// --- What the page asks of the desktop (the other ends are in preload.cts) ---

function listenToPage() {
  ipcMain.on("app:hide-to-tray", hideMainWindowToTray);
  ipcMain.on("app:toggle-maximise", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle("app:is-maximised", () => mainWindow?.isMaximized() ?? false);
  ipcMain.on("app:quit", () => app.quit());

  ipcMain.on("now:update", (_event, step: NowStep) => {
    nowStep = step;
    updateTrayMenu();
  });
  ipcMain.on("app:unsaved", (_event, what: string | null) => {
    unsaved = what;
  });

  ipcMain.handle("backup:newest", newestBackup);
  ipcMain.handle("backup:write", (_event, json: string) => writeBackup(json));
}

// --- Backups ---

// When the newest backup was written (ms), or null if there is none. A file gone between listing and
// reading (pruned meanwhile) counts for nothing.
function newestBackup() {
  const times = backupFiles().flatMap((name) => {
    try {
      return [fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs];
    } catch {
      return [];
    }
  });
  return times.length > 0 ? Math.max(...times) : null;
}

// Writes today's backup (replacing one written earlier today), then drops all but the newest.
// The backups hold all the user's data, so only the user can read them.
function writeBackup(json: string) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.chmodSync(BACKUP_DIR, 0o700);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const file = path.join(BACKUP_DIR, `${date}.json`);
  // Written whole beside it, then put in its place, so a crash mid-write leaves the last good one; a write
  // that fails (a full disk) takes its partial file with it
  try {
    fs.writeFileSync(`${file}.partial`, json, { mode: 0o600 });
    fs.renameSync(`${file}.partial`, file);
  } catch (error) {
    fs.rmSync(`${file}.partial`, { force: true });
    throw error;
  }
  // Today's is in place: an old one that can't be removed is left, and isn't a failed backup
  for (const name of backupFiles().sort().slice(0, -BACKUPS_KEPT)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, name));
    } catch (error) {
      console.error(`Could not remove the old backup ${name}`, error);
    }
  }
}

function backupFiles() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name));
}

// --- Quitting ---

// Quitting with work unsaved asks first, as an editor does: Save, Discard or Cancel
function askIfUnsaved(event: Electron.Event) {
  if (unsaved && mainWindow) {
    event.preventDefault();
    void askBeforeQuit();
    return;
  }
  quitting = true;
}

async function askBeforeQuit() {
  if (askingToQuit || !mainWindow) return;
  askingToQuit = true;
  showMainWindow();
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    message: `You have unsaved ${unsaved}.`,
    detail: "Save them before quitting?",
    buttons: ["Save", "Discard", "Cancel"],
    defaultId: 0,
    cancelId: 2,
  });
  // A save the page refuses leaves the app open, showing why
  const leave = response === 1 || (response === 0 && (await saveInPage()));
  askingToQuit = false;
  if (!leave) return;
  unsaved = null;
  app.quit();
}

// Asks the page to save what it holds; true once saved, false if it couldn't or didn't answer in time
function saveInPage() {
  const request = ++saveRequest;
  return new Promise<boolean>((resolve) => {
    const settle = (saved: boolean) => {
      clearTimeout(giveUp);
      ipcMain.removeListener("app:saved-for-quit", answer);
      resolve(saved);
    };
    const answer = (_event: unknown, saved: boolean, answered: number) => {
      if (answered === request) settle(saved);
    };
    const giveUp = setTimeout(() => settle(false), SAVE_FOR_QUIT_MS);
    ipcMain.on("app:saved-for-quit", answer);
    mainWindow!.webContents.send("app:save-for-quit", request);
  });
}
