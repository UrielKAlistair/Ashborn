import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, today } from "../../src/shared/dates";

// Focus: the most urgent ready step, why it is there, Not now passing to the next, Split turning
// it into smaller steps, and Done ticking it.

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
    { id: id.apply, title: "Apply to DTL", parent_id: id.quest },
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

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await test.step("the most urgent ready step, and why", async () => {
    await expect(now).toContainText("Read the survey", { timeout: 15_000 });
    await expect(now).toContainText("P1");
    await expect(now).toContainText("Leads to Give the talk");
    await expect(now).not.toContainText("Then:");
    await expect(now).toContainText("1 of 2");
  });

  await test.step("the graph marks the step in Now, and the mark follows Not now", async () => {
    const tag = (stepId: string) => page.locator(`.react-flow__node[data-id="${stepId}"]`).getByText("Now", { exact: true });
    await expect(tag(id.survey)).toBeVisible();
    await now.getByRole("button", { name: "Not now" }).click();
    await expect(tag(id.apply)).toBeVisible();
    await expect(tag(id.survey)).toHaveCount(0);
    await now.getByRole("button", { name: "Not now" }).click();
    await expect(tag(id.survey)).toBeVisible();
  });

  await test.step("its title shows it on the graph", async () => {
    await now.getByTitle("Show on the graph").click();
    await expect(page.locator('.react-flow__node[data-id="' + id.survey + '"]')).toHaveClass(/node-flash/);
  });

  await test.step("Not now passes to the next, raised by its deadline", async () => {
    await now.getByRole("button", { name: "Not now" }).click();
    await expect(now).toContainText("Apply to DTL");
    await expect(now).toContainText("P2");
    await expect(now).toContainText("Applications close, due in 3d");
    await now.getByRole("button", { name: "Not now" }).click();
    await expect(now).toContainText("Read the survey");
  });

  await test.step("the keys: N passes, / goes to the capture field and typing there passes nothing", async () => {
    await page.keyboard.press("n");
    await expect(now).toContainText("Apply to DTL");
    await page.keyboard.press("n");
    await expect(now).toContainText("Read the survey");
    await page.keyboard.press("/");
    await expect(page.getByLabel("Capture a thought")).toBeFocused();
    await page.keyboard.type("n");
    await expect(now).toContainText("Read the survey");
    await page.getByLabel("Capture a thought").fill("");
    await page.getByLabel("Capture a thought").blur();
  });

  await test.step("Split turns it into smaller steps, the first of which comes up next", async () => {
    await now.getByRole("button", { name: "Too big? Split it" }).click();
    await now.getByRole("button", { name: "Copy a prompt for Claude" }).click();
    await expect(now).toContainText("Copied. Paste Claude's answer here.");
    const prompt = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(prompt).toContain("Task: Read the survey");
    expect(prompt).toContain("Finishing it unlocks: Give the talk");
    await now.getByLabel("Steps, one per line").fill("Skim the abstract\nRead section 2");
    await now.getByRole("button", { name: "Add steps" }).click();
    await expect(now).toContainText("Skim the abstract");
    await expect(now).toContainText("Work · Read the survey");
    await expect(now).toContainText("Then: Read section 2");
  });

  await test.step("Done ticks it, without moving the card; Done today can untick it", async () => {
    const before = (await now.boundingBox())!.y;
    await now.getByRole("button", { name: "Done" }).click();
    await expect(now).toContainText("Read section 2");
    expect((await now.boundingBox())!.y).toBe(before);
    await expect.poll(async () => (await db.from("graph_nodes").select("completed_at").eq("title", "Skim the abstract").single()).data?.completed_at).toBeTruthy();
    await page.getByRole("button", { name: /of progress today/ }).click();
    await expect(page.getByRole("list", { name: "Done today" })).toContainText("Skim the abstract");
    await page.getByRole("list", { name: "Done today" }).getByTitle("Mark not done").click();
    await expect(now).toContainText("Skim the abstract");
    await expect.poll(async () => (await db.from("graph_nodes").select("completed_at").eq("title", "Skim the abstract").single()).data?.completed_at).toBeNull();
    await now.getByRole("button", { name: "Done" }).click();
    await expect(now).toContainText("Read section 2");
  });

  await test.step("a priority on a quest reads as the quest's, not as a step it leads to", async () => {
    const errands = crypto.randomUUID();
    await insert("graph_nodes", [{ id: errands, title: "Errands", parent_id: null, priority: 1 }]);
    await insert("graph_nodes", [{ id: crypto.randomUUID(), title: "Buy stamps", parent_id: errands }]);
    await expect(now).toContainText(/of \d/);
    for (let i = 0; i < 5 && !(await now.textContent())?.includes("Buy stamps"); i++) await page.keyboard.press("n");
    await expect(now).toContainText("Buy stamps");
    await expect(now).toContainText("Part of Errands, which has this priority");
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
