import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { today } from "../../src/shared/dates";

// Start on Now: a 15-minute box that holds the step in Now, ends with "Done, or keep going?", and
// survives a reload; and a step passed over on three days asks why.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("start timer and passing over", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const id = { quest: crypto.randomUUID(), draft: crypto.randomUUID(), email: crypto.randomUUID(), tidy: crypto.randomUUID() };
  const insert = async (rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from("graph_nodes").insert(rows);
    if (insertError) throw insertError;
  };
  await insert([{ id: id.quest, title: "Work", parent_id: null, priority: 1 }]);
  await insert([
    { id: id.draft, title: "Draft the intro", parent_id: id.quest },
    { id: id.email, title: "Email the professor", parent_id: id.quest },
    { id: id.tidy, title: "Tidy the notes", parent_id: id.quest },
  ]);

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const now = page.getByRole("region", { name: "Now" });
  const first = () => now.getByRole("listitem").first();
  // The first row's ⋯ menu, then one of its items
  const choose = async (item: string) => {
    await first().getByRole("button", { name: /^Actions for/ }).click();
    await now.getByRole("menuitem", { name: item }).click();
  };
  const storage = (key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(now).toContainText("Draft the intro", { timeout: 15_000 });

  await test.step("Start boxes the step: it holds Now, Not now goes, Stop ends it", async () => {
    await choose("Start (15 min)");
    await expect(now.getByRole("timer", { name: "Time left" })).toContainText(/1[45]:\d\d/);
    await expect(now.getByRole("listitem")).toHaveCount(1);
    await first().getByRole("button", { name: /^Actions for/ }).click();
    await expect(now.getByRole("menuitem", { name: "Not now" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByText("The rest of the list waits until the timer ends.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Up next" })).toHaveCount(0);
    await page.keyboard.press("n");
    await expect(now).toContainText("Draft the intro");
    await page.reload();
    await expect(now.getByRole("timer", { name: "Time left" })).toBeVisible({ timeout: 15_000 });
    await expect(now).toContainText("Draft the intro");
    await now.getByRole("button", { name: "Stop" }).click();
    await expect(now.getByRole("timer")).toHaveCount(0);
    expect(await storage("ashborn-now-timer")).toBeNull();
    await expect(page.getByText("Up next", { exact: true })).toBeVisible();
  });

  await test.step("when the time is up: Done, or keep going", async () => {
    await page.evaluate((stepId) => localStorage.setItem("ashborn-now-timer", JSON.stringify({ stepId, startedAt: Date.now() - 60_000, endsAt: Date.now() - 1 })), id.email);
    await page.reload();
    await expect(now).toContainText("Email the professor", { timeout: 15_000 });
    await expect(now).toContainText("Time's up. Done, or keep going?");
    await expect(page.getByText("Up next", { exact: true })).toBeVisible(); // the box is over
    await now.getByRole("button", { name: "5 more minutes" }).click();
    await expect(now.getByRole("timer", { name: "Time left" })).toContainText(/[45]:\d\d/);
    await now.getByTitle("Mark done").click();
    await expect(first()).toContainText("Draft the intro");
    await expect(now.getByRole("timer")).toHaveCount(0);
    expect(await storage("ashborn-now-timer")).toBeNull();
  });

  await test.step("passing a step over counts once a day, and on the third day Now asks why", async () => {
    await page.evaluate(() => localStorage.removeItem("ashborn-passed-over"));
    await expect(now.getByRole("listitem")).toHaveCount(2);
    await choose("Not now");
    await expect(first()).toContainText("Tidy the notes");
    await page.reload(); // a step put off stays put off for the day
    await expect(first()).toContainText("Tidy the notes", { timeout: 15_000 });
    await choose("Not now");
    await expect(first()).toContainText("Draft the intro");
    await choose("Not now");
    expect((await storage("ashborn-passed-over"))[id.draft]).toEqual({ days: 1, last: today() });
    // As if it had been put off on three earlier days, and not yet today
    await page.evaluate((stepId) => {
      localStorage.setItem("ashborn-passed-over", JSON.stringify({ [stepId]: { days: 3, last: "2026-01-01" } }));
      localStorage.removeItem("ashborn-now-passed");
    }, id.draft);
    await page.reload();
    await expect(first()).toContainText("Draft the intro", { timeout: 15_000 });
    await expect(now).toContainText("Passed over on 3 days. Too big, or waiting on something?");
    await choose("Split it");
    await now.getByLabel("Steps, one per line").fill("Write the first sentence");
    await now.getByRole("button", { name: /^Add step/ }).click();
    await expect(now).toContainText("Write the first sentence");
    expect(await storage("ashborn-passed-over")).toEqual({});
  });

  await test.step("the notice at time up comes on any screen", async () => {
    await page.evaluate(() => {
      const said: string[] = [];
      (window as unknown as { said: string[] }).said = said;
      window.Notification = class {
        static permission = "granted";
        constructor(title: string) {
          said.push(title);
        }
      } as unknown as typeof Notification;
    });
    await page.getByRole("button", { name: "Alarms", exact: true }).click();
    await expect(page.getByRole("region", { name: "Now" })).toHaveCount(0); // off Home for real
    await page.evaluate((stepId) => {
      localStorage.setItem("ashborn-now-timer", JSON.stringify({ stepId, startedAt: Date.now(), endsAt: Date.now() + 1500 }));
      window.dispatchEvent(new Event("ashborn:now-memory"));
    }, id.tidy);
    await expect.poll(() => page.evaluate(() => (window as unknown as { said: string[] }).said)).toEqual(["Time's up: Tidy the notes"]);
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
