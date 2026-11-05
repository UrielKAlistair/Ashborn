import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// The quests' automatic layout: packed to the canvas, reflowing when one is added elsewhere,
// dragged quests staying put with the rest around them, and the two resets.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/graph-layout/shots";

let app: ElectronApplication;
let page: Page;
let profile: string;
const ids = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID(), step: crypto.randomUUID() };

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  await db.from("graph_nodes").delete().not("id", "is", null);
  const insert = async (rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from("graph_nodes").insert(rows);
    if (insertError) throw insertError;
  };
  await insert([
    { id: ids.a, title: "DDP Work", parent_id: null },
    { id: ids.b, title: "Placement", parent_id: null },
    { id: ids.c, title: "Errands", parent_id: null },
  ]);
  const step = (title: string, parentId: string) => ({ id: crypto.randomUUID(), title, parent_id: parentId });
  await insert([
    { ...step("DDP one", ids.a), id: ids.step },
    step("DDP two", ids.a),
    step("DDP three", ids.a),
    step("Placement one", ids.b),
    step("Placement two", ids.b),
    step("Placement three", ids.b),
    step("Errand one", ids.c),
    step("Errand two", ids.c),
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

const questBoxes = () => page.locator(".react-flow__node-quest");

// Canvas rectangles of the quests, once the layout has left them still for 600 ms
async function rects() {
  const read = () =>
    questBoxes().evaluateAll((all) =>
      all.map((el) => {
        const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform)!;
        return { title: el.textContent ?? "", x: Number(x), y: Number(y), width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight };
      }),
    );
  let previous = JSON.stringify(await read());
  for (let still = 0; still < 4; ) {
    await page.waitForTimeout(150);
    const now = JSON.stringify(await read());
    still = now === previous ? still + 1 : 0;
    previous = now;
  }
  return JSON.parse(previous) as Array<{ title: string; x: number; y: number; width: number; height: number }>;
}

function expectNoOverlap(list: Awaited<ReturnType<typeof rects>>) {
  list.forEach((a, i) =>
    list.slice(i + 1).forEach((b) => {
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart, `${a.title} / ${b.title}`).toBe(true);
    }),
  );
}

// A node's position on the canvas, which a refit of the view does not change
const canvasPosition = (node: ReturnType<Page["locator"]>) => node.evaluate((element) => (element as HTMLElement).style.transform);

const savedX = async (id: string) => (await db.from("graph_nodes").select("x").eq("id", id).single()).data?.x ?? null;

test("quest layout", async () => {
  await test.step("sign in: quests spread across the wide window, not one column", async () => {
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(questBoxes()).toHaveCount(3, { timeout: 20_000 });
    const list = await rects();
    expectNoOverlap(list);
    expect(new Set(list.map(({ x }) => x)).size).toBeGreaterThan(1);
    await page.screenshot({ path: `${shots}/after-auto.png` });
  });

  await test.step("a quest added elsewhere reflows into free space", async () => {
    await db.from("graph_nodes").insert({ title: "Online BSc", parent_id: null });
    await expect(questBoxes()).toHaveCount(4, { timeout: 10_000 });
    expectNoOverlap(await rects());
    await page.screenshot({ path: `${shots}/after-agent-add.png` });
  });

  await test.step("a dragged quest keeps its place and pins only itself; the rest pack around it", async () => {
    const dragged = page.locator(".react-flow__node-quest", { hasText: "DDP Work" });
    const before = (await dragged.boundingBox())!;
    await page.mouse.move(before.x + 120, before.y + 40);
    await page.mouse.down();
    await page.mouse.move(before.x + 300, before.y + 260, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => savedX(ids.a)).not.toBeNull();
    expect(await savedX(ids.b)).toBeNull();
    expect(await savedX(ids.c)).toBeNull();
    const list = await rects();
    const placed = list.find(({ title }) => title.includes("DDP Work"))!;
    expect(placed.x).toBeCloseTo((await savedX(ids.a))!, 2);
    expectNoOverlap(list);
    await page.screenshot({ path: `${shots}/after-drag.png` });
  });

  await test.step("a layout that lands mid-drag leaves the dragged quest where the pointer has it", async () => {
    const dragged = questBoxes().filter({ hasText: "Placement" });
    const start = (await dragged.boundingBox())!;
    await page.mouse.move(start.x + 120, start.y + 40);
    await page.mouse.down();
    await page.mouse.move(start.x + 140, start.y + 360, { steps: 8 });
    const held = await canvasPosition(dragged);
    await db.from("graph_nodes").insert({ title: "Added mid-drag", parent_id: null });
    await expect(questBoxes()).toHaveCount(5, { timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await canvasPosition(dragged)).toEqual(held);
    await page.mouse.up();
    await expect.poll(() => savedX(ids.b)).not.toBeNull();
  });

  await test.step("a priority that only reorders the quests keeps the view where it was", async () => {
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    await page.mouse.move(pane.x + 8, pane.y + pane.height - 8);
    await page.mouse.down();
    await page.mouse.move(pane.x + 68, pane.y + pane.height - 48, { steps: 4 });
    await page.mouse.up();
    const view = () => page.locator(".react-flow__viewport").evaluate((element) => (element as HTMLElement).style.transform);
    const panned = await view();
    const order = async () => (await rects()).map(({ title }) => title).join();
    const before = await order();
    const { error } = await db.from("graph_nodes").update({ priority: 1, changed_at: { priority: new Date().toISOString() } }).eq("id", ids.c);
    if (error) throw error;
    await expect.poll(order, { timeout: 10_000 }).not.toBe(before);
    await page.waitForTimeout(800);
    expect(await view()).toBe(panned);
  });

  await test.step("clicking away from Reset layout changes nothing", async () => {
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reset quests?" })).toBeVisible();
    await page.screenshot({ path: `${shots}/after-reset-options.png` });
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 400 } });
    await expect(page.getByRole("button", { name: "Reset layout", exact: true })).toBeVisible();
    expect(await savedX(ids.a)).not.toBeNull();
  });

  await test.step("Reset quests leaves the steps inside boxes where they were", async () => {
    await db.from("graph_nodes").update({ x: 16, y: 200 }).eq("id", ids.step);
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    await page.getByRole("button", { name: "Reset quests?" }).click();
    await expect.poll(() => savedX(ids.a)).toBeNull();
    expect(await savedX(ids.step)).toBe(16);
    expectNoOverlap(await rects());
  });

  await test.step("a step placed under the header stays clear of it when the title grows to more lines", async () => {
    await db.from("graph_nodes").update({ x: 16, y: 10, changed_at: { x: new Date().toISOString(), y: new Date().toISOString() } }).eq("id", ids.step);
    await db.from("graph_nodes").update({ title: "DDP Work: the survey, both presentations and the five-fold results", changed_at: { title: new Date().toISOString() } }).eq("id", ids.a);
    const quest = page.locator(".react-flow__node-quest", { hasText: "five-fold" });
    await expect(quest).toBeVisible({ timeout: 10_000 });
    await rects();
    const header = (await quest.locator("div.group.relative").first().boundingBox())!;
    const card = (await page.locator(".react-flow__node-step", { hasText: "DDP one" }).boundingBox())!;
    expect(card.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  });

  await test.step("the sub-option resets the steps too", async () => {
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    await page.getByRole("button", { name: "Also steps in every box" }).click();
    await expect.poll(() => savedX(ids.step)).toBeNull();
  });

  await test.step("the phone window keeps quests one screen wide", async () => {
    await phoneWindow(app, page);
    await page.reload();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("menu", { name: "Home" }).getByRole("menuitem", { name: "Graph" }).click();
    await expect(page.locator(".react-flow__node-quest").first()).toBeVisible({ timeout: 20_000 });
    const list = await rects();
    expectNoOverlap(list);
    expect(Math.max(...list.map(({ x, width }) => x + width))).toBeLessThanOrEqual(Math.max(...list.map(({ width }) => width)));
    await page.screenshot({ path: `${shots}/after-phone.png` });
  });
});
