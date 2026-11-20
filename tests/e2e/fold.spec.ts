import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, startOfDay, today as todayDate } from "../../src/shared/dates";

// Folding finished chains, on data seeded straight into the test user's rows: a box finished today
// folds to one line at once; steps and boxes finished on an earlier day leave the graph until their
// quest's "done earlier" shows them, a finished box among them folded and opened on a click; a
// finished quest leaves the graph for the Completed list, can be archived and unarchived, and comes
// back with Reopen; an opening from an earlier day no longer counts.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

let app: ElectronApplication;
let page: Page;
let profile: string;
const pageErrors: string[] = [];

const today = todayDate();
const dayStart = startOfDay(today);
const minutes = (base: Date, offset: number) => new Date(base.getTime() + offset * 60_000).toISOString();
const twoDaysAgo = minutes(dayStart, -2 * 24 * 60);
const justNow = new Date().toISOString();

const ids = {
  quest: crypto.randomUUID(),
  box: crypto.randomUUID(),
  openedBox: crypto.randomUUID(),
  justFinished: crypto.randomUUID(),
  todayBox: crypto.randomUUID(),
  doneQuest: crypto.randomUUID(),
};

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) {
    const { error: wipeError } = await db.from(table).delete().not("id", "is", null);
    if (wipeError) throw wipeError;
  }

  const step = (title: string, parentId: string, completedAt: string | null) => ({ id: crypto.randomUUID(), title, parent_id: parentId, completed_at: completedAt });
  await must(
    db.from("graph_nodes").insert([
      { id: ids.quest, title: "Open quest", parent_id: null },
      { id: ids.doneQuest, title: "Done quest", parent_id: null },
    ]),
  );
  await must(
    db.from("graph_nodes").insert([
      { id: ids.box, title: "Finished box", parent_id: ids.quest, completed_at: twoDaysAgo },
      { id: ids.openedBox, title: "Opened yesterday", parent_id: ids.quest, completed_at: twoDaysAgo },
      { id: ids.justFinished, title: "Just finished", parent_id: ids.quest, completed_at: justNow },
      { id: ids.todayBox, title: "Open box", parent_id: ids.quest, completed_at: null },
      step("Still open", ids.quest, null),
      step("Done quest step", ids.doneQuest, twoDaysAgo),
    ]),
  );
  await must(
    db.from("graph_nodes").insert([
      step("Inner one", ids.box, twoDaysAgo),
      step("Inner two", ids.box, twoDaysAgo),
      step("Opened inner", ids.openedBox, twoDaysAgo),
      step("Just inner", ids.justFinished, justNow),
      step("Today inner", ids.todayBox, null),
      step("Done in an open box", ids.todayBox, twoDaysAgo),
    ]),
  );

  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const nodes = () => page.locator(".react-flow__node");
const card = (title: string) => nodes().filter({ hasText: title }).last();

test("finished chains fold", async () => {
  await test.step("sign in, with a box opened yesterday on this device", async () => {
    await page.evaluate(([id, day]) => window.localStorage.setItem("ashborn-opened", JSON.stringify({ [id]: day })), [ids.openedBox, addDays(today, -1)]);
    await page.reload();
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(card("Open quest")).toBeVisible({ timeout: 15_000 });
  });

  await test.step("a box finished a moment ago folds to one line; what finished on an earlier day is gone", async () => {
    await expect(card("Just finished")).toContainText("1 done");
    await expect(nodes().filter({ hasText: "Just inner" })).toHaveCount(0);
    for (const title of ["Finished box", "Opened yesterday", "Done in an open box"]) await expect(nodes().filter({ hasText: title })).toHaveCount(0);
    await expect(card("Open quest")).toContainText("3 done earlier");
  });

  await test.step("an open box and an open step stay in place", async () => {
    await expect(card("Today inner")).toBeVisible();
    await expect(card("Still open")).toBeVisible();
  });

  await test.step("a finished quest leaves the graph for Completed, and Reopen brings it back", async () => {
    await expect(nodes().filter({ hasText: "Done quest" })).toHaveCount(0);
    await page.getByRole("button", { name: /Quests/ }).click();
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    await page.getByRole("button", { name: /Completed\s*1/ }).click();
    await expect(page.getByRole("checkbox", { name: "Done quest" })).toHaveCount(0);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("button", { name: /Archive\s*1/ }).click();
    await expect(page.getByRole("button", { name: /Completed/ })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Done quest" })).toHaveCount(0);
    // Completed is still open: it stayed mounted, empty, while its quest was archived
    await page.getByRole("button", { name: "Unarchive" }).click();
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(card("Done quest step")).toBeVisible();
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 400 } });
  });

  await test.step("done earlier brings them back, finished boxes folded; yesterday's opening no longer counts", async () => {
    await card("Open quest").getByRole("button", { name: "3 done earlier" }).click();
    await expect(card("Done in an open box").getByTitle("Mark not done")).toBeVisible();
    await expect(card("Finished box")).toContainText("2 done");
    await expect(card("Opened yesterday")).toContainText("1 done");
    await expect(nodes().filter({ hasText: "Opened inner" })).toHaveCount(0);
  });

  await test.step("a click opens a folded box, and it stays open after a reload today", async () => {
    await card("Finished box").getByTitle("Show its steps").click();
    await expect(card("Inner one")).toBeVisible();
    await page.reload();
    await expect(card("Inner two")).toBeVisible({ timeout: 15_000 });
  });

  await test.step("midnight reads the data again, for the reads bounded by date", async () => {
    // The page's clock set half a minute before the next midnight
    await page.clock.install({ time: new Date(startOfDay(addDays(todayDate(), 1)).getTime() - 30_000) });
    await page.reload();
    await expect(card("Inner two")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000); // the first reads settle
    let reads = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes("/nodes_with_xp?") && !request.url().includes("id=eq")) reads++;
    });
    await page.clock.runFor(60_000);
    await expect.poll(() => reads).toBeGreaterThan(0);
  });

  expect(pageErrors).toEqual([]);
});

async function must(query: PromiseLike<{ error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}
