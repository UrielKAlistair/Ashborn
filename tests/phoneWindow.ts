import { expect, type ElectronApplication, type Page } from "@playwright/test";

// Makes the app's window phone-sized, so the page lays itself out as the phone app. On the
// headless Wayland display the compositor restores the unmaximised size a moment after
// unmaximize(), undoing a setSize made at once, so the size is set until it holds.
export async function phoneWindow(app: ElectronApplication, page: Page) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await expect
    .poll(async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(400, 860));
      await page.waitForTimeout(300);
      return page.evaluate(() => innerWidth);
    })
    .toBe(400);
}
