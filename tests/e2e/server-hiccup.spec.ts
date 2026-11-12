import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A read the server fails with an error that may pass (a 503) is treated as a lost connection: the
// data on screen stays, marked offline, and the app tries again by itself until the server answers

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test.beforeEach(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const { error: insertError } = await db.from("graph_nodes").insert([{ title: "Hiccup quest", parent_id: null }]);
  if (insertError) throw insertError;
});

test("a server error on reading shows the last data and is tried again", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Hiccup quest").first()).toBeVisible({ timeout: 15_000 });

  await page.route("**/rest/v1/nodes_with_xp*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Service Unavailable" }) }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/^Offline: /)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Hiccup quest").first()).toBeVisible();

  // Tried again on the app's own timer once the server answers
  await page.unroute("**/rest/v1/nodes_with_xp*");
  await expect(page.getByText(/^Offline: /)).toHaveCount(0, { timeout: 40_000 });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});

// With nothing saved on the device to show, the first read is tried again too
test("a first read that fails, with nothing saved here, is tried again", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  await page.route("**/rest/v1/nodes_with_xp*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Service Unavailable" }) }),
  );
  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/^Your data can't be read yet \(.*\); trying again\.$/)).toBeVisible({ timeout: 15_000 });
  // Past the live connection's join, which reads again on its own
  await page.waitForTimeout(10_000);

  await page.unroute("**/rest/v1/nodes_with_xp*");
  await expect(page.getByText("Hiccup quest").first()).toBeVisible({ timeout: 60_000 });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
