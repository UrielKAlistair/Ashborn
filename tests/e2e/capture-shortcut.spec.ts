import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The desktop-wide capture shortcut: registered at start, and when it fires, from another screen,
// the app comes back to Home with the capture field focused. The key press itself is the OS's; the
// test sends what the shortcut sends.

test("capture shortcut and the keys list", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Alarms", exact: true }).click();
  await expect(page.getByLabel("Capture a thought")).toHaveCount(0);

  expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("CommandOrControl+Alt+Space"))).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("app:capture"));
  await expect(page.getByLabel("Capture a thought")).toBeFocused();

  await test.step("? lists the keys; Escape closes the list and keeps the window", async () => {
    await page.getByLabel("Capture a thought").blur();
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keys" })).toContainText("Capture from anywhere on the desktop");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keys" })).toHaveCount(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
