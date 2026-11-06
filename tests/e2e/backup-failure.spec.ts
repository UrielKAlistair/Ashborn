import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A backup that fails for a reason other than a lost connection (a refused read, say) would fail the
// same way every night, unseen: it is said on screen. Only the backup reads stock_changes on its own (the
// app reads it inside the meals).

test("a backup refused by the server is said, not swallowed", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  await page.route("**/rest/v1/stock_changes*", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "permission denied for table stock_changes" }) })
      : route.continue(),
  );

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/^Backup not made: stock_changes: permission denied for table stock_changes/)).toBeVisible({ timeout: 20_000 });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
