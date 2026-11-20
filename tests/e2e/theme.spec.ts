import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// The redesign's shell: no navigation until signed in, and the theme switch, which lasts across a
// reload and switches back; on the phone, Settings holds the theme.

test("rail and theme switch", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE; // set in some shells; it makes Electron start as plain Node
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups"); // the test user's data stays out of the real backups
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const rail = page.getByRole("button", { name: "Kitchen", exact: true });
  const theme = () => page.locator("html").getAttribute("data-theme");

  await test.step("signed out, there is no rail", async () => {
    await expect(page.getByPlaceholder("Email")).toBeVisible({ timeout: 15_000 });
    await expect(rail).toHaveCount(0);
  });

  await test.step("signed in, the rail shows", async () => {
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(rail).toBeVisible({ timeout: 15_000 });
  });

  await test.step("the switch goes to the light theme, a reload keeps it, then back to dark", async () => {
    await page.getByTitle(/^Light/).click();
    await expect.poll(theme).toBe("light");
    await page.reload();
    await expect(rail).toBeVisible({ timeout: 15_000 });
    expect(await theme()).toBe("light");
    await page.getByTitle(/^Dark/).click();
    await expect.poll(theme).toBe("dark");
  });

  await test.step("a device that chose Meadow, the light theme's old name, opens in light", async () => {
    await page.evaluate(() => localStorage.setItem("ashborn-theme", "meadow"));
    await page.reload();
    await expect(rail).toBeVisible({ timeout: 15_000 });
    expect(await theme()).toBe("light");
  });

  await test.step("on the phone, Settings holds the theme", async () => {
    await phoneWindow(app, page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" }).click();
    await expect.poll(theme).toBe("dark");
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
