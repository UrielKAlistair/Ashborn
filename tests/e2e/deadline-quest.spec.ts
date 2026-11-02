import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, today } from "../../src/shared/dates";

// A deadline linked to nothing raises nothing. "Make it a quest" makes one of the same name and
// links it, so the deadline's priority reaches Now, which asks for a first step.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("make a deadline a quest", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const { error: insertError } = await db.from("deadlines").insert([{ title: "Judge the science fest", due_date: addDays(today(), 2), node_id: null }]);
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
  await expect(deadlines).toContainText("Judge the science fest", { timeout: 15_000 });
  await expect(now).toHaveCount(0);

  await deadlines.getByRole("button", { name: "Make it a quest" }).click();
  await expect(now).toContainText("Judge the science fest");
  await expect(now).toContainText("Judge the science fest, due in 2d");
  await expect(now.getByRole("button", { name: "Add a first step" })).toBeVisible();
  await expect(deadlines.getByRole("button", { name: "Make it a quest" })).toHaveCount(0);
  await expect
    .poll(async () => {
      const quest = (await db.from("graph_nodes").select("id").eq("title", "Judge the science fest").maybeSingle()).data;
      const deadline = (await db.from("deadlines").select("node_id").eq("title", "Judge the science fest").single()).data;
      return quest && deadline?.node_id === quest.id;
    })
    .toBe(true);

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
