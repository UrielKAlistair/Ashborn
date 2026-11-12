import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A streamed change that needs a read before it can be shown (a row not on screen) must not land
// after a newer change that didn't (its delete), and the read must not hold back what comes after it.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("a row deleted while its read is on the way stays deleted, and a slow read holds nothing back", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  await db.from("graph_nodes").delete().not("id", "is", null);
  const quest = crypto.randomUUID();
  const { error: seedError } = await db.from("graph_nodes").insert({ id: quest, title: "Order", parent_id: null });
  if (seedError) throw seedError;
  const { error: stepError } = await db.from("graph_nodes").insert({ id: crypto.randomUUID(), title: "Already here", parent_id: quest });
  if (stepError) throw stepError;

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".react-flow__node-step", { hasText: "Already here" })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000); // past the read when the server starts listening

  // A step made elsewhere is not on screen, so it is read before it shows; the read is slowed, and the
  // step deleted once the read has found it, so the read lands after the delete
  let found = 0;
  await page.route("**/rest/v1/nodes_with_xp*", async (route) => {
    if (route.request().method() !== "GET" || !/id=eq/.test(route.request().url())) return route.continue();
    const response = await route.fetch();
    found += 1;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.fulfill({ response });
  });

  const ghost = crypto.randomUUID();
  const { error: ghostError } = await db.from("graph_nodes").insert({ id: ghost, title: "Ghost", parent_id: quest });
  if (ghostError) throw ghostError;
  await expect.poll(() => found, { timeout: 5000 }).toBeGreaterThan(0);
  const { error: deleteError } = await db.from("graph_nodes").delete().eq("id", ghost);
  if (deleteError) throw deleteError;
  // Nor does a slow read hold back what comes after it
  const { error: titleError } = await db.from("graph_nodes").update({ title: "Quick change", changed_at: { title: new Date().toISOString() } }).eq("id", quest);
  if (titleError) throw titleError;
  await expect(page.locator(".react-flow__node-quest", { hasText: "Quick change" })).toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(7000);
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.locator(".react-flow__node-step", { hasText: "Ghost" })).toHaveCount(0);

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
