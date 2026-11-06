import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A change still on its way when the connection goes joins the offline queue with the rest, in the order
// made: a change made after it (here a tick of the item it adds) is checked against it, not refused as
// deleted, and is sent after it

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("a change on its way as the connection goes keeps its place in the queue", async () => {
  const { data: auth, error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const work = crypto.randomUUID();
  for (const rows of [
    [{ id: auth.user.id, title: "Inbox", parent_id: null }, { id: work, title: "Work", parent_id: null }],
    [{ title: "Old step", parent_id: work }],
  ]) {
    const { error: insertError } = await db.from("graph_nodes").insert(rows);
    if (insertError) throw insertError;
  }

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const step = (title: string) => page.locator(".react-flow__node-step", { hasText: title });
  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(step("Old step")).toBeVisible({ timeout: 15_000 });
  // The read again on the live connection's join lands first: one finishing after the network goes
  // would mark the app online again for a moment
  await page.waitForTimeout(3000);

  // The capture's create is held on its way, then lost with the connection
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let holding = true;
  await page.route("**/rest/v1/graph_nodes*", async (route) => {
    if (route.request().method() !== "POST" || !holding) return route.continue();
    holding = false;
    await held;
    await route.abort("internetdisconnected");
  });
  await page.getByLabel("Capture a thought").fill("Fresh thought");
  await page.getByLabel("Capture a thought").press("Enter");
  await expect(step("Fresh thought")).toBeVisible();

  await page.context().setOffline(true);
  await step("Old step").getByTitle("Mark done").first().click();
  await expect(page.getByText(/will sync when you're back online/)).toBeVisible();
  await step("Fresh thought").getByTitle("Mark done").first().click();
  await expect(page.getByText(/2 changes will sync|3 changes will sync/)).toBeVisible();
  await expect(page.getByText(/deleted on another device/)).toHaveCount(0);

  release();
  await page.context().setOffline(false);
  await expect(page.getByText(/will sync/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/Not saved from offline/)).toHaveCount(0);
  const { data } = await db.from("graph_nodes").select("completed_at").eq("title", "Fresh thought").single();
  expect(data?.completed_at).toBeTruthy();

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
