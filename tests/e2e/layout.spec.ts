import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// The quests' automatic layout: packed to the canvas, reflowing when one is added elsewhere, and
// cards that can't be dragged out of it.

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

  await test.step("dragging a card leaves the layout as it was", async () => {
    const card = page.locator(".react-flow__node-quest", { hasText: "DDP Work" });
    const before = await rects();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 260, { steps: 8 });
    await page.mouse.up();
    expect(await rects()).toEqual(before);
    expect(await savedX(ids.a)).toBeNull();
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

  await test.step("a window that settles at a new size is fitted again, unless the view was moved", async () => {
    const scale = () => page.locator(".react-flow__viewport").evaluate((element) => Number(/scale\(([\d.]+)\)/.exec((element as HTMLElement).style.transform)![1]));
    const resize = async (width: number, height: number) => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
      await expect
        .poll(async () => {
          await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height]);
          await page.waitForTimeout(300);
          return page.evaluate(() => innerWidth);
        })
        .toBe(width);
      await page.waitForTimeout(900);
    };
    await resize(1400, 900);
    await page.getByRole("button", { name: "Fit View" }).click();
    await page.waitForTimeout(600);
    const fitted = await scale();
    await resize(760, 560);
    expect(await scale()).toBeLessThan(fitted * 0.9);
    await resize(1400, 900);
    expect(await scale()).toBeCloseTo(fitted, 2);

    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(600);
    const zoomed = await scale();
    await resize(760, 560);
    expect(await scale()).toBe(zoomed);

    await page.getByRole("button", { name: "Fit View" }).click();
    await page.getByRole("button", { name: "Zoom In" }).click();
    await page.waitForTimeout(600);
    const buttonZoomed = await scale();
    await resize(1400, 900);
    expect(await scale()).toBe(buttonZoomed);
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
