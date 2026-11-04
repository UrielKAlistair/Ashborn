import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, today } from "../../src/shared/dates";

// With nothing prioritised, Ready starts open. A deadline linked to a quest only groups it there: due
// tomorrow, it still raises nothing, so Now waits for a priority the user gives.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("a linked deadline raises nothing; a priority given in Ready reaches Now", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const quest = crypto.randomUUID();
  const { error: nodeError } = await db.from("graph_nodes").insert([{ id: quest, title: "Reading", parent_id: null }]);
  if (nodeError) throw nodeError;
  const { error: stepError } = await db.from("graph_nodes").insert([
    { id: crypto.randomUUID(), title: "Read chapter 1", parent_id: quest },
    { id: crypto.randomUUID(), title: "Read chapter 2", parent_id: quest },
  ]);
  if (stepError) throw stepError;
  const { error: insertError } = await db.from("deadlines").insert([{ title: "Reading quiz", due_date: addDays(today(), 1), node_id: quest }]);
  if (insertError) throw insertError;

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const now = page.getByRole("region", { name: "Now" });
  const deadlines = page.getByRole("group", { name: "Deadlines" });

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(deadlines).toContainText("Reading quiz", { timeout: 15_000 });
  // Due tomorrow and linked to Reading, yet nothing is prioritised, so there is no Now
  await expect(now).toHaveCount(0);

  // With nothing prioritised, Ready is open from the start: giving a priority is the way to a Now
  await expect(page.getByRole("group", { name: "Priority for Read chapter 1" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Up next" })).toContainText("Give a quest a priority below");
  // Two ready in one quest: one priority on the quest covers both
  await expect(page.getByText("2 ready")).toBeVisible();
  await page.getByRole("group", { name: "Priority for all of Reading" }).getByRole("button", { name: "P3" }).click();
  await expect(now).toContainText("Read chapter 1");
  await expect(page.getByRole("group", { name: "Priority for Read chapter 2" })).toHaveCount(0);
  await expect.poll(async () => (await db.from("graph_nodes").select("priority").eq("id", quest).single()).data?.priority).toBe(3);

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
