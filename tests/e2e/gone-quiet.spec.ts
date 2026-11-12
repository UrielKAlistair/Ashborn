import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// Gone quiet, at the top of Today: what the server stamps decides it. Moving a quest or giving it a
// priority doesn't bring it back; a level-up, a new step or shelving does. A P1 quest is quiet after
// three days, any other after seven, on the to-do or not. Seeded with old creation dates.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/lower-cost/shots";
const uuid = () => crypto.randomUUID();
const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

test("gone quiet", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) await db.from(table).delete().not("id", "is", null);
  const ids = { urgent: uuid(), notYet: uuid(), moved: uuid(), levelled: uuid(), given: uuid(), extended: uuid(), shelved: uuid(), fresh: uuid() };
  const old = (id: string, title: string, days: number, priority: number | null = null) => ({ id, title, parent_id: null, created_at: daysAgo(days), priority });
  const { error: questError } = await db.from("graph_nodes").insert([
    old(ids.urgent, "Urgent and stalled", 4, 1),
    old(ids.notYet, "Four days on a P2", 4, 2),
    old(ids.moved, "Moved around", 40),
    old(ids.levelled, "Levelled up", 30),
    old(ids.given, "Given a priority", 20),
    old(ids.extended, "Extended", 15),
    old(ids.shelved, "Shelved it", 10),
    old(ids.fresh, "Fresh quest", 0),
  ]);
  if (questError) throw questError;
  const stepAge = { urgent: 4, notYet: 4, fresh: 0 } as Record<string, number>;
  const { error: stepError } = await db.from("graph_nodes").insert(
    Object.entries(ids).map(([key, parent]) => ({ id: uuid(), title: `Step of ${key}`, parent_id: parent, created_at: daysAgo(stepAge[key] ?? 40) })),
  );
  if (stepError) throw stepError;

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (pageError) => pageErrors.push(pageError.message));

  const section = page.getByRole("region", { name: "Gone quiet" });
  const header = section.getByText(/^Gone quiet\s*\d+$/);
  const now = page.getByRole("region", { name: "Now" });
  const chips = (title: string) => section.getByRole("group", { name: `Priority for ${title}` });
  const row = (title: string) => section.getByRole("listitem").filter({ hasText: title });
  const titles = () => section.getByTitle("Show on the graph").allInnerTexts();

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(header).toContainText("6", { timeout: 20_000 });

  await test.step("at the top; P1 first, then longest quiet; three until unfolded; a new quest isn't there", async () => {
    expect((await section.boundingBox())!.y).toBeLessThan((await now.boundingBox())!.y);
    await expect(section).toContainText("What's up?");
    expect(await titles()).toEqual(["Urgent and stalled", "Moved around", "Levelled up"]);
    await section.getByRole("button", { name: "Show all 6" }).click();
    expect(await titles()).toEqual(["Urgent and stalled", "Moved around", "Levelled up", "Given a priority", "Extended", "Shelved it"]);
    await expect(row("Urgent and stalled")).toContainText("P1 · Quiet for 4 days · 1 open step");
    await expect(row("Moved around")).toContainText("Quiet for 40 days · 1 open step");
    // On the to-do and quiet: it shows in both. Four days on a P2 isn't quiet yet
    await expect(now).toContainText("Step of urgent");
    await expect(section.getByText("Four days on a P2")).toHaveCount(0);
    // Their steps aren't listed again under Ready: only the new quest's is
    await expect(page.getByRole("button", { name: /Ready, no priority/ })).toHaveText(/Ready, no priority\s*1$/);
    await page.screenshot({ path: `${shots}/gone-quiet.png` });
  });

  await test.step("moving on the server doesn't count, even after a reload", async () => {
    const { error: placeError } = await db.rpc("place_nodes", { places: [{ id: ids.moved, x: 900, y: 900 }] });
    if (placeError) throw placeError;
    const { data } = await db.from("graph_nodes").select("x, changed_at").eq("id", ids.moved).single();
    expect(data?.x).toBe(900);
    expect(Object.keys(data?.changed_at ?? {})).toContain("x"); // the stamps are there; the rule passes them over
    await page.reload();
    await expect(header).toContainText("6", { timeout: 20_000 });
  });

  await test.step("a level-up counts, as it arrives from elsewhere", async () => {
    await page.waitForTimeout(3000); // the reloaded page hears changes only once it has subscribed
    const { error: logError } = await db.from("progress_log").insert({ node_id: ids.levelled, amount: 10 });
    if (logError) throw logError;
    await expect(header).toContainText("5");
    await expect(section.getByText("Levelled up")).toHaveCount(0);
  });

  await test.step("a priority puts it on the to-do but isn't work, so it stays quiet; with Undo", async () => {
    await chips("Given a priority").getByRole("button", { name: "P2" }).click();
    await expect(page.getByRole("status")).toContainText("P2: Given a priority");
    await expect(now).toContainText("Step of given");
    await expect(row("Given a priority")).toContainText("P2 · Quiet for 20 days");
    await expect(header).toContainText("5");
    await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect(now).not.toContainText("Step of given");
    await expect(row("Given a priority").getByText(/Quiet for/)).not.toContainText("P2");
  });

  await test.step("Show on graph finds it; a step added there counts", async () => {
    await row("Extended").getByRole("button", { name: "Show on graph" }).click();
    await expect(page.locator(`.react-flow__node[data-id="${ids.extended}"]`)).toHaveClass(/node-flash/);
    const { error: addError } = await db.from("graph_nodes").insert({ title: "Pick it up again", parent_id: ids.extended });
    if (addError) throw addError;
    await expect(section.getByText("Extended")).toHaveCount(0);
    await expect(header).toContainText("4");
  });

  await test.step("Shelve puts it away, with Undo", async () => {
    await row("Shelved it").getByRole("button", { name: "Shelve", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Shelved: Shelved it");
    await expect(section.getByText("Shelved it")).toHaveCount(0);
    await expect.poll(async () => (await db.from("graph_nodes").select("shelved").eq("id", ids.shelved).single()).data?.shelved).toBe(true);
    await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await db.from("graph_nodes").select("shelved").eq("id", ids.shelved).single()).data?.shelved).toBe(false);
    await expect(section.getByText("Shelved it")).toBeVisible(); // back, still quiet
    await page.reload(); // and as the server counts it, too
    await expect(section.getByText("Shelved it")).toBeVisible({ timeout: 20_000 });
  });

  await test.step("on the phone, within the width", async () => {
    await phoneWindow(app, page);
    await expect(section.getByText("Moved around")).toBeVisible();
    await page.screenshot({ path: `${shots}/gone-quiet-phone.png` });
    const shelve = (await section.getByRole("button", { name: "Shelve", exact: true }).first().boundingBox())!;
    expect(shelve.x + shelve.width).toBeLessThanOrEqual(400);
    expect(shelve.height).toBeGreaterThanOrEqual(32);
  });

  expect(pageErrors).toEqual([]);
  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
