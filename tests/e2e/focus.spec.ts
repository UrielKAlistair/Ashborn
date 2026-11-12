import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, today } from "../../src/shared/dates";

// Focus: Now lists the most urgent ready steps, the first being the one to do, without reasons; the
// tick, or D for the first, does it.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("focus", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const id = { quest: crypto.randomUUID(), survey: crypto.randomUUID(), talk: crypto.randomUUID(), apply: crypto.randomUUID() };
  const insert = async (table: string, rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from(table).insert(rows);
    if (insertError) throw insertError;
  };
  await insert("graph_nodes", [{ id: id.quest, title: "Work", parent_id: null }]);
  await insert("graph_nodes", [
    { id: id.survey, title: "Read the survey", parent_id: id.quest },
    { id: id.talk, title: "Give the talk", parent_id: id.quest, priority: 1 },
    { id: id.apply, title: "Apply to DTL", parent_id: id.quest, priority: 2 },
    { id: crypto.randomUUID(), title: "Tidy the notes", parent_id: id.quest },
    { id: crypto.randomUUID(), title: "Water the plants", parent_id: id.quest },
  ]);
  await insert("graph_edges", [{ from_id: id.survey, to_id: id.talk }]);
  await insert("deadlines", [{ title: "Applications close", due_date: addDays(today(), 3), node_id: id.apply }]);

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const now = page.getByRole("region", { name: "Now" });
  const first = () => now.getByRole("listitem").first();
  const tag = (stepId: string) => page.locator(`.react-flow__node[data-id="${stepId}"]`).getByText("Now", { exact: true });
  const completedAt = async (stepId: string) => (await db.from("graph_nodes").select("completed_at").eq("id", stepId).single()).data?.completed_at;

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await test.step("the most urgent ready steps, the first to do now, with no reasons", async () => {
    await expect(first()).toContainText("Read the survey", { timeout: 15_000 });
    await expect(now.getByRole("listitem")).toHaveText([/Read the survey/, /Apply to DTL/]);
    for (const reason of ["P1", "Leads to", "Then:", "due in", "1 of 2"]) await expect(now).not.toContainText(reason);
    // Deadlines lead the panel
    const deadlines = page.getByRole("group", { name: "Deadlines" });
    await expect(deadlines).toContainText("Applications close");
    expect((await deadlines.boundingBox())!.y).toBeLessThan((await now.boundingBox())!.y);
  });

  await test.step("the graph marks the step in Now", async () => {
    await expect(tag(id.survey)).toBeVisible();
    await expect(tag(id.apply)).toHaveCount(0);
  });

  await test.step("its title shows it on the graph", async () => {
    await first().getByTitle("Show on the graph").click();
    await expect(page.locator('.react-flow__node[data-id="' + id.survey + '"]')).toHaveClass(/node-flash/);
  });

  await test.step("Done ticks it, without moving the card; what it unlocks comes next, and the mark follows", async () => {
    const before = (await now.boundingBox())!.y;
    await first().getByTitle("Mark done").click();
    await expect(first()).toContainText("Give the talk");
    expect((await now.boundingBox())!.y).toBe(before);
    await expect.poll(() => completedAt(id.survey)).toBeTruthy();
    await expect(tag(id.talk)).toBeVisible();
    await expect(tag(id.survey)).toHaveCount(0);
  });

  await test.step("D ticks the first, but not under the keys list", async () => {
    await page.keyboard.press("?");
    await page.keyboard.press("d");
    await page.waitForTimeout(300);
    expect(await completedAt(id.talk)).toBeNull();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keys" })).toHaveCount(0);
    await page.keyboard.press("d");
    await expect(first()).toContainText("Apply to DTL");
    await expect.poll(() => completedAt(id.talk)).toBeTruthy();
  });

  await test.step("a step of a prioritised quest comes up in Now", async () => {
    const errands = crypto.randomUUID();
    await insert("graph_nodes", [{ id: errands, title: "Errands", parent_id: null, priority: 1 }]);
    await insert("graph_nodes", [{ id: crypto.randomUUID(), title: "Buy stamps", parent_id: errands }]);
    await expect(now).toContainText("Buy stamps");
  });

  await test.step("a ready step without a priority gets one from the to-do", async () => {
    await expect(page.getByRole("region", { name: "Now" })).not.toContainText("Tidy the notes");
    await page.getByRole("button", { name: /Ready, no priority/ }).click();
    await expect(page.getByText("P1 most urgent, P4 least")).toBeVisible();
    await page.getByRole("group", { name: "Priority for Tidy the notes" }).getByRole("button", { name: "P2" }).dblclick();
    await expect(page.getByRole("group", { name: "Priority for Tidy the notes" })).toHaveCount(0);
    await expect.poll(async () => (await db.from("graph_nodes").select("priority").eq("title", "Tidy the notes").single()).data?.priority).toBe(2);
    // The double-click's second press landed where the next row had slid up, and was let go
    await expect(page.getByRole("group", { name: "Priority for Water the plants" })).toBeVisible();
    expect((await db.from("graph_nodes").select("priority").eq("title", "Water the plants").single()).data?.priority).toBeNull();
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
