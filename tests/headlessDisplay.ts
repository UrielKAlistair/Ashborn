import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// Electron under test never reaches the user's desktop: its windows open on a headless Wayland
// display of its own (mutter, GNOME's compositor), and its tray icon on a session bus of its own
// (the tray speaks D-Bus to the panel, not Wayland). Imported by every Playwright config that
// launches the app: on import it points this process and the workers at that display; as
// globalSetup it starts the bus and mutter, unless another run's are already up, and returns
// their teardown. The run that started them stops them, even under another run still using them;
// research/channel/run.lock keeps runs from overlapping.

const DISPLAY_NAME = "ashborn-e2e";
const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/run/user/1000";
const socket = path.join(runtimeDir, DISPLAY_NAME);
// The private bus's address, for runs and workers that find the display already up
const busFile = path.join(runtimeDir, `${DISPLAY_NAME}.bus`);

process.env.WAYLAND_DISPLAY = DISPLAY_NAME;
process.env.ELECTRON_OZONE_PLATFORM_HINT = "wayland";
delete process.env.DISPLAY;
if (existsSync(socket) && existsSync(busFile)) process.env.DBUS_SESSION_BUS_ADDRESS = readFileSync(busFile, "utf8").trim();

export default async function startHeadlessDisplay() {
  if (existsSync(socket) && existsSync(busFile)) return;
  const [address, busPid] = execFileSync("dbus-daemon", ["--session", "--fork", "--print-address=1", "--print-pid=1"], { encoding: "utf8" }).trim().split("\n");
  writeFileSync(busFile, address);
  process.env.DBUS_SESSION_BUS_ADDRESS = address;
  const mutter = spawn("mutter", ["--headless", "--wayland", "--no-x11", "--virtual-monitor", "1920x1080", "--wayland-display", DISPLAY_NAME], {
    detached: true,
    stdio: "ignore",
  });
  for (let waited = 0; !existsSync(socket); waited += 100) {
    if (waited > 10_000) throw new Error(`mutter did not open the display ${socket}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return () => {
    process.kill(-mutter.pid!);
    process.kill(Number(busPid));
    rmSync(busFile, { force: true });
  };
}
