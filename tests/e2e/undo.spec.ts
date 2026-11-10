import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// Undo after a tick: from the graph and from Now; one toast, the newest; gone after a few
// seconds; and a tick that folds a quest away comes back.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/lower-cost/shots";

let app: ElectronApplication;
let page: Page;
let profile: string;
const uuid = () => crypto.randomUUID();
const ids = { talk: uuid(), first: uuid(), second: uuid(), third: uuid(), fourth: uuid(), errand: uuid(), only: uuid() };

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) await db.from(table).delete().not("id", "is", null);
  const insert = async (rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from("graph_nodes").insert(rows);
    if (insertError) throw insertError;
  };
  await insert([
    { id: ids.talk, title: "Talk", parent_id: null, priority: 1 },
    { id: ids.errand, title: "Errand", parent_id: null, priority: null },
  ]);
  await insert([
    { id: ids.first, title: "First step", parent_id: ids.talk },
    { id: ids.second, title: "Second step", parent_id: ids.talk },
    { id: ids.third, title: "Third step", parent_id: ids.talk },
    { id: ids.fourth, title: "Fourth step", parent_id: ids.talk },
    { id: ids.only, title: "The only step", parent_id: ids.errand },
  ]);

  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const toast = () => page.getByRole("status").filter({ hasText: /Done:|P\d:/ });
const undo = () => toast().getByRole("button", { name: "Undo" });
const stepCard = (title: string) => page.locator(".react-flow__node-step", { hasText: title });
const graphTick = (title: string) => stepCard(title).getByRole("button", { name: /^Mark/ });
const upNext = () => page.getByRole("region", { name: "Now" });
const isDone = async (id: string) => {
  const { data, error } = await db.from("graph_nodes").select("completed_at").eq("id", id).single();
  if (error) throw error;
  return data.completed_at !== null;
};

test("undo a tick", async () => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(stepCard("First step")).toBeVisible({ timeout: 20_000 });
  await expect(toast()).toHaveCount(0);

  await test.step("a tick on the graph offers Undo, which sets it not done", async () => {
    await graphTick("First step").click();
    await expect(toast()).toContainText("Done: First step");
    await expect.poll(() => isDone(ids.first)).toBe(true);
    await expect(toast()).toHaveCSS("opacity", "1"); // faded in
    await page.screenshot({ path: `${shots}/undo-ember.png` });
    await undo().click();
    await expect(toast()).toHaveCount(0);
    await expect.poll(() => isDone(ids.first)).toBe(false);
  });

  await test.step("Focus's Done offers it too, and Undo brings the step back to the card", async () => {
    const focus = page.getByRole("region", { name: "Now" });
    const row = focus.getByRole("listitem").first();
    const shown = await row.getByTitle("Show on the graph").innerText();
    await row.getByTitle("Mark done").click();
    await expect(toast()).toContainText(`Done: ${shown}`);
    await expect(focus).not.toContainText(shown);
    await undo().click();
    await expect(focus).toContainText(shown);
  });

  await test.step("a tick further down Now offers it, the newest replaces the last, and it leaves by itself", async () => {
    await page.getByRole("button", { name: /Show all \d+ ready/ }).click();
    await upNext().getByRole("listitem").filter({ hasText: "Third step" }).getByRole("button", { name: "Mark done" }).click();
    await expect(toast()).toContainText("Done: Third step");

    await graphTick("First step").click();
    await expect(toast()).toHaveCount(1);
    await expect(toast()).toContainText("Done: First step");

    await page.waitForTimeout(3000); // the newer tick started the time again: still here
    await expect(toast()).toBeVisible();
    await expect(toast()).toHaveCount(0, { timeout: 5000 });
    await expect.poll(() => isDone(ids.first)).toBe(true); // it stays done
    expect(await isDone(ids.third)).toBe(true);
    await expect(graphTick("First step")).toHaveAttribute("title", "Mark not done");
  });

  await test.step("unticking the step by hand takes the offer away", async () => {
    await graphTick("Second step").click();
    await expect(toast()).toContainText("Second step");
    await graphTick("Second step").click();
    await expect(toast()).toHaveCount(0);
    await expect(graphTick("First step")).toHaveAttribute("title", "Mark not done");
  });

  await test.step("the tick that folds a quest away can be undone", async () => {
    await graphTick("The only step").click();
    await expect(page.locator(".react-flow__node-quest", { hasText: "Errand" })).toHaveCount(0);
    await undo().click();
    await expect(page.locator(".react-flow__node-quest", { hasText: "Errand" })).toBeVisible();
    await expect(stepCard("The only step")).toBeVisible();
  });

  await test.step("giving a step a priority from the list offers Undo, which takes it back", async () => {
    const priorityOf = async (id: string) => (await db.from("graph_nodes").select("priority").eq("id", id).single()).data?.priority;
    await page.getByRole("button", { name: /Ready, no priority/ }).click();
    const chips = page.getByRole("group", { name: "Priority for The only step" });
    await chips.getByRole("button", { name: "P3" }).click();
    await expect(toast()).toContainText("P3: The only step");
    await expect(chips).toHaveCount(0);
    await expect.poll(() => priorityOf(ids.only)).toBe(3);
    await undo().click();
    await expect(toast()).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Ready, no priority/ })).toContainText("1"); // back, the list closed since it had emptied
    await expect.poll(() => priorityOf(ids.only)).toBeNull();
  });

  await test.step("a delete the server refuses leaves the step, and its offer comes back", async () => {
    await page.route("**/rest/v1/rpc/delete_node*", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "refused for the test", details: null, hint: null }) }),
    );
    await graphTick("Fourth step").click();
    await expect(toast()).toContainText("Done: Fourth step");
    await stepCard("Fourth step").getByTitle("Delete").click();
    await stepCard("Fourth step").getByTitle("Click again to delete").click();
    await expect(toast()).toContainText("Done: Fourth step");
    await expect(stepCard("Fourth step")).toBeVisible();
    await page.unroute("**/rest/v1/rpc/delete_node*");
    await undo().click();
    await expect.poll(() => isDone(ids.fourth)).toBe(false);
  });

  await test.step("deleting the step takes the offer away: there is nothing left to undo", async () => {
    await graphTick("Fourth step").click();
    await expect(toast()).toContainText("Done: Fourth step");
    await stepCard("Fourth step").getByTitle("Delete").click();
    await stepCard("Fourth step").getByTitle("Click again to delete").click();
    await expect(stepCard("Fourth step")).toHaveCount(0);
    // At once, well inside the toast's own 6 s
    await expect(toast()).toHaveCount(0, { timeout: 1000 });
  });

  await test.step("it reads in every theme, and on the phone it sits above the tabs", async () => {
    await expect(graphTick("First step")).toHaveAttribute("title", "Mark not done");
    for (const theme of ["light"]) {
      await page.evaluate((name) => document.documentElement.setAttribute("data-theme", name), theme);
      await graphTick("The only step").click();
      await expect(toast()).toHaveCSS("opacity", "1");
      await page.screenshot({ path: `${shots}/undo-${theme}.png` });
      await undo().click();
      await expect(toast()).toHaveCount(0);
    }
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

    await phoneWindow(app, page);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("menu", { name: "Home" }).getByRole("menuitem", { name: "To-do" }).click();
    const focus = page.getByRole("region", { name: "Now" });
    await focus.getByRole("listitem").first().getByTitle("Mark done").click();
    await expect(toast()).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `${shots}/undo-phone.png` });
    const box = (await toast().boundingBox())!;
    const tabs = (await page.getByRole("button", { name: "Home", exact: true }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
    // Only Undo takes taps: a tap on its words reaches what lies under them
    const underWords = await toast().evaluate((el) => {
      const words = el.querySelector("span")!.getBoundingClientRect();
      return el.contains(document.elementFromPoint(words.left + 4, words.top + words.height / 2));
    });
    expect(underWords).toBe(false);
  });

  expect(pageErrors).toEqual([]);
});
