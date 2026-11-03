import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, today } from "../../src/shared/dates";

// With nothing prioritised, Ready starts open. A deadline linked to nothing raises nothing; "Make it a
// quest" makes one of the same name and links it, so the deadline's priority reaches Now, which asks
// for a first step.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("make a deadline a quest", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const { error: insertError } = await db.from("deadlines").insert([{ title: "Judge the science fest", due_date: addDays(today(), 1), node_id: null }]);
  if (insertError) throw insertError;
  const quest = crypto.randomUUID();
  const { error: nodeError } = await db.from("graph_nodes").insert([{ id: quest, title: "Reading", parent_id: null }]);
  if (nodeError) throw nodeError;
  const { error: stepError } = await db.from("graph_nodes").insert([
    { id: crypto.randomUUID(), title: "Read chapter 1", parent_id: quest },
    { id: crypto.randomUUID(), title: "Read chapter 2", parent_id: quest },
  ]);
  if (stepError) throw stepError;

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

  // With nothing prioritised, Ready is open from the start: giving a priority is the way to a Now
  await expect(page.getByRole("group", { name: "Priority for Read chapter 1" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Up next" })).toContainText("Give a quest a priority below");
  // Two ready in one quest: one priority on the quest covers both
  await expect(page.getByText("2 ready")).toBeVisible();
  await page.getByRole("group", { name: "Priority for all of Reading" }).getByRole("button", { name: "P3" }).click();
  await expect(now).toContainText("Read chapter 1");
  await expect(page.getByRole("group", { name: "Priority for Read chapter 2" })).toHaveCount(0);
  await expect.poll(async () => (await db.from("graph_nodes").select("priority").eq("id", quest).single()).data?.priority).toBe(3);

  // Due tomorrow and linked to nothing: it comes up top, with the same ways to link it. (The test's day
  // starts at midnight and the app's at the account's hour, so between them "tomorrow" may read as 2d.)
  const dueSoon = page.getByRole("region", { name: "Due soon, linked to nothing" });
  await expect(dueSoon).toContainText(/Judge the science fest due (tomorrow|in 2d), linked to nothing/);
  await deadlines.getByRole("button", { name: "Make it a quest" }).click();
  await expect(dueSoon).toHaveCount(0);
  // Due soon, it outranks Reading's P3: first, asking for a first step
  await expect(now.getByRole("listitem").first()).toContainText("Judge the science fest");
  await expect(now.getByRole("listitem").first().getByRole("button", { name: "Add a first step" })).toBeVisible();
  await expect(deadlines.getByRole("button", { name: "Make it a quest" })).toHaveCount(0);
  await expect
    .poll(async () => {
      const quest = (await db.from("graph_nodes").select("id").eq("title", "Judge the science fest").maybeSingle()).data;
      const deadline = (await db.from("deadlines").select("node_id").eq("title", "Judge the science fest").single()).data;
      return quest && deadline?.node_id === quest.id;
    })
    .toBe(true);

  await test.step("a deadline whose title names a quest offers that quest, and linking it brings its steps to Now", async () => {
    const { error: readingError } = await db.from("deadlines").insert([{ title: "Reading quiz", due_date: addDays(today(), 1), node_id: null }]);
    if (readingError) throw readingError;
    await expect(deadlines.getByRole("button", { name: "Link to Reading" })).toBeVisible({ timeout: 15_000 });
    await expect(deadlines.getByRole("button", { name: "or make it a quest" })).toBeVisible();
    await deadlines.getByRole("button", { name: "Link to Reading" }).click();
    await expect(deadlines.getByRole("button", { name: "Link to Reading" })).toHaveCount(0);
    await expect.poll(async () => (await db.from("deadlines").select("node_id").eq("title", "Reading quiz").single()).data?.node_id).toBe(quest);
    await expect(now).toContainText("Read chapter 1");
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
