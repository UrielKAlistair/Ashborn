import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// Gone quiet: what the server stamps decides it. Moving or recolouring a quest doesn't bring it back;
// a level-up, a priority, a new step or shelving does. Seeded with old creation dates.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/lower-cost/shots";
const uuid = () => crypto.randomUUID();
const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

test("gone quiet", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) await db.from(table).delete().not("id", "is", null);
  const ids = { moved: uuid(), levelled: uuid(), given: uuid(), extended: uuid(), shelved: uuid(), fresh: uuid() };
  const old = (id: string, title: string, days: number) => ({ id, title, parent_id: null, created_at: daysAgo(days) });
  const { error: questError } = await db.from("graph_nodes").insert([
    old(ids.moved, "Moved around", 40),
    old(ids.levelled, "Levelled up", 30),
    old(ids.given, "Given a priority", 20),
    old(ids.extended, "Extended", 15),
    old(ids.shelved, "Shelved it", 10),
    { id: ids.fresh, title: "Fresh quest", parent_id: null, created_at: daysAgo(0) },
  ]);
  if (questError) throw questError;
  const { error: stepError } = await db.from("graph_nodes").insert(
    Object.entries(ids).map(([key, parent]) => ({ id: uuid(), title: `Step of ${key}`, parent_id: parent, created_at: key === "fresh" ? daysAgo(0) : daysAgo(40) })),
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

  const section = page.getByRole("group", { name: "Gone quiet" });
  const header = section.getByRole("button", { name: /Gone quiet/ });
  const chips = (title: string) => page.getByRole("group", { name: `Priority for ${title}` });
  const row = (title: string) => section.locator("div.rounded-lg", { hasText: title });
  const titles = () => section.locator("p.text-\\[13px\\]").allInnerTexts();

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(header).toContainText("5", { timeout: 20_000 });

  await test.step("folded, then longest quiet first, with a count of days; a new quest isn't there", async () => {
    await expect(section.getByText("Moved around")).toHaveCount(0);
    await header.click();
    expect(await titles()).toEqual(["Moved around", "Levelled up", "Given a priority", "Extended", "Shelved it"]);
    await expect(section).toContainText("Quiet for 40 days · 1 open step");
    // Their steps aren't listed again under Ready: only the new quest's is
    await expect(page.getByRole("button", { name: /Ready, no priority/ })).toHaveText(/Ready, no priority\s*1$/);
    await page.screenshot({ path: `${shots}/gone-quiet.png` });
  });

  await test.step("moving and recolouring on the server doesn't count, even after a reload", async () => {
    const { error: placeError } = await db.rpc("place_nodes", { places: [{ id: ids.moved, x: 900, y: 900 }] });
    if (placeError) throw placeError;
    const { error: colorError } = await db.from("graph_nodes").update({ color: "red", changed_at: { color: new Date().toISOString() } }).eq("id", ids.moved);
    if (colorError) throw colorError;
    const { data } = await db.from("graph_nodes").select("x, color, changed_at").eq("id", ids.moved).single();
    expect(data?.x).toBe(900);
    expect(Object.keys(data?.changed_at ?? {})).toContain("x"); // the stamps are there; the rule passes them over
    await page.reload();
    await expect(header).toContainText("5", { timeout: 20_000 });
  });

  await test.step("a level-up counts, as it arrives from elsewhere", async () => {
    await page.waitForTimeout(3000); // the reloaded page hears changes only once it has subscribed
    const { error: logError } = await db.from("progress_log").insert({ node_id: ids.levelled, amount: 10 });
    if (logError) throw logError;
    await expect(header).toContainText("4");
    await header.click();
    await expect(section.getByText("Levelled up")).toHaveCount(0);
  });

  await test.step("a priority brings it to the to-do, with Undo", async () => {
    await chips("Given a priority").getByRole("button", { name: "P2" }).click();
    await expect(page.getByRole("status")).toContainText("P2: Given a priority");
    await expect(header).toContainText("3");
    await expect(page.getByRole("region", { name: "Now" })).toContainText("Step of given");
    await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("region", { name: "Now" })).toHaveCount(0);
    // A priority isn't work, so with it undone the quest is as quiet as before
    await expect(section.getByText("Given a priority")).toBeVisible();
    await expect(header).toContainText("4");
  });

  await test.step("a next step counts, and goes inside", async () => {
    await row("Extended").getByRole("button", { name: "Add a next step" }).click();
    await expect(section.getByText("Next steps", { exact: true })).toBeVisible();
    await section.getByLabel("Steps, one per line").fill("Pick it up again");
    await section.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(async () => (await db.from("graph_nodes").select("parent_id").eq("title", "Pick it up again").maybeSingle()).data?.parent_id).toBe(ids.extended);
    await expect(section.getByText("Extended")).toHaveCount(0);
  });

  await test.step("Shelve puts it away, with Undo", async () => {
    await row("Shelved it").getByRole("button", { name: "Shelve" }).click();
    await expect(page.getByRole("status")).toContainText("Shelved: Shelved it");
    await expect(section.getByText("Shelved it")).toHaveCount(0);
    await expect.poll(async () => (await db.from("graph_nodes").select("shelved").eq("id", ids.shelved).single()).data?.shelved).toBe(true);
    await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await db.from("graph_nodes").select("shelved").eq("id", ids.shelved).single()).data?.shelved).toBe(false);
    await expect(section.getByText("Shelved it")).toBeVisible(); // back, still quiet
    await page.reload(); // and as the server counts it, too
    await header.click();
    await expect(section.getByText("Shelved it")).toBeVisible({ timeout: 20_000 });
    await expect(section.getByText("Given a priority")).toBeVisible();
  });

  await test.step("on the phone, within the width", async () => {
    await phoneWindow(app, page);
    await header.click();
    await expect(section.getByText("Moved around")).toBeVisible();
    await section.getByText("Moved around").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/gone-quiet-phone.png` });
    const shelve = (await section.getByRole("button", { name: "Shelve" }).first().boundingBox())!;
    expect(shelve.x + shelve.width).toBeLessThanOrEqual(400);
    expect(shelve.height).toBeGreaterThanOrEqual(32);
  });

  expect(pageErrors).toEqual([]);
  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
