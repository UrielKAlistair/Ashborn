import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A streamed change that needs a read before it can be shown (a tick also moves today's count) must
// not land after a newer change that didn't, and the read must not hold back what comes after it.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("the latest streamed change stands, and a slow read holds nothing back", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  await db.from("graph_nodes").delete().not("id", "is", null);
  const quest = crypto.randomUUID();
  const step = crypto.randomUUID();
  const { error: seedError } = await db.from("graph_nodes").insert({ id: quest, title: "Order", parent_id: null });
  if (seedError) throw seedError;
  const { error: stepError } = await db.from("graph_nodes").insert([
    { id: step, title: "Tick me", parent_id: quest },
    { id: crypto.randomUUID(), title: "Leave me", parent_id: quest },
  ]);
  if (stepError) throw stepError;
  const setDone = async (done: boolean) => {
    const at = new Date().toISOString();
    const { error: updateError } = await db.from("graph_nodes").update({ completed_at: done ? at : null, changed_at: { completed_at: at } }).eq("id", step);
    if (updateError) throw updateError;
  };

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const tick = page.locator(".react-flow__node-step", { hasText: "Tick me" }).getByRole("button", { name: /^Mark/ });
  await expect(tick).toHaveAttribute("title", "Mark done", { timeout: 20_000 });
  await page.waitForTimeout(4000); // past the read when the server starts listening

  // Today's count is read slowly, so the tick waits for it while the untick, which needs no read, goes ahead
  let held = 0;
  await page.route("**/rest/v1/graph_nodes*", async (route) => {
    if (route.request().method() !== "HEAD") return route.continue();
    held += 1;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({ response });
  });

  await setDone(true);
  await expect.poll(() => held, { timeout: 5000 }).toBeGreaterThan(0);
  await setDone(false);
  // Nor does a slow read hold back what comes after it
  const { error: titleError } = await db.from("graph_nodes").update({ title: "Quick change", changed_at: { title: new Date().toISOString() } }).eq("id", quest);
  if (titleError) throw titleError;
  await expect(page.locator(".react-flow__node-quest", { hasText: "Quick change" })).toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(5000);
  await page.unrouteAll({ behavior: "wait" });

  const { data } = await db.from("graph_nodes").select("completed_at").eq("id", step).single();
  expect(data?.completed_at).toBeNull();
  await expect(tick).toHaveAttribute("title", "Mark done");

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
