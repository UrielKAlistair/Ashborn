import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The phone graph's own layout: quests in one column in priority order, prerequisites above what
// they lead to, and nothing the desktop placed read or written. The view opens on the column's top,
// as wide as the screen. SHOTS=<dir> also saves a screenshot in each theme.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = process.env.SHOTS;

let app: ElectronApplication;
let page: Page;
let profile: string;
const pageErrors: string[] = [];

const ids = { urgent: crypto.randomUUID(), placed: crypto.randomUUID(), first: crypto.randomUUID(), second: crypto.randomUUID(), loose: crypto.randomUUID() };
// Where the desktop put things, which the phone must neither use nor change
const desktop = { [ids.placed]: { x: 900, y: 700 }, [ids.second]: { x: 400, y: 300 } };

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) {
    const { error: wipeError } = await db.from(table).delete().not("id", "is", null);
    if (wipeError) throw wipeError;
  }
  // One row at a time: a batch fills the columns a row leaves out with null
  for (const row of [
    { id: ids.placed, title: "Placed on the desktop", parent_id: null, ...desktop[ids.placed] },
    { id: ids.urgent, title: "Urgent errands", parent_id: null, priority: 1, changed_at: { priority: new Date().toISOString() } },
    { id: ids.first, title: "Draft the statement", parent_id: ids.placed },
    { id: ids.second, title: "Send the statement", parent_id: ids.placed, ...desktop[ids.second] },
    { id: ids.loose, title: "Buy stamps", parent_id: ids.urgent },
  ])
    await must(db.from("graph_nodes").insert(row));
  await must(db.from("graph_edges").insert({ from_id: ids.first, to_id: ids.second }));

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

const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
// A node's position in its parent box (React Flow's transform), and its size
const box = (id: string) =>
  node(id).evaluate((element) => {
    const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((element as HTMLElement).style.transform)!;
    return { x: Number(x), y: Number(y), width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight };
  });
const saved = async (id: string) => (await db.from("graph_nodes").select("x, y").eq("id", id).single()).data;

test("the phone graph's own layout", async () => {
  await test.step("sign in, in a portrait phone window", async () => {
    await windowSize(412, 915);
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await openGraph();
  });

  await test.step("quests stack in one column, the more urgent first, wherever the desktop put them", async () => {
    // Polled whole: before the layout lands every node sits at the origin, where x is already 0
    const column = async () => {
      const [urgent, placed] = [await box(ids.urgent), await box(ids.placed)];
      return { urgentX: urgent.x, placedX: placed.x, placedBelow: placed.y > urgent.y + urgent.height };
    };
    await expect.poll(column).toEqual({ urgentX: 0, placedX: 0, placedBelow: true });
  });

  await test.step("a prerequisite sits above the step it leads to, and links run downward", async () => {
    const first = await box(ids.first);
    const second = await box(ids.second);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    expect(second).not.toMatchObject(desktop[ids.second]);
    await expect(node(ids.first).locator(".react-flow__handle-bottom")).toHaveCount(1);
    await expect(node(ids.second).locator(".react-flow__handle-top")).toHaveCount(1);
  });

  await test.step("the view opens on the column's top, as wide as the screen", async () => {
    const view = await page.locator(".react-flow__viewport").evaluate((element) => new DOMMatrix(getComputedStyle(element).transform));
    const widest = Math.max((await box(ids.urgent)).width, (await box(ids.placed)).width);
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    expect(view.a).toBeLessThanOrEqual(1);
    expect(widest * view.a).toBeLessThanOrEqual(pane.width);
    await expect(page.getByText("Urgent errands")).toBeInViewport();
  });

  await test.step("nothing the desktop placed was changed", async () => {
    expect(await saved(ids.placed)).toEqual(desktop[ids.placed]);
    expect(await saved(ids.second)).toEqual(desktop[ids.second]);
    expect(await saved(ids.urgent)).toEqual({ x: null, y: null });
  });

  for (const theme of ["dark", "light"]) {
    await test.step(`screenshot (${theme})`, async () => {
      await page.evaluate((stored) => localStorage.setItem("ashborn-theme", stored), theme);
      await page.reload();
      await openGraph();
      await expect(page.getByText("Send the statement")).toBeVisible();
      if (shots) await page.screenshot({ path: path.join(shots, `phone-layout-${theme}.png`) });
    });
  }

  expect(pageErrors).toEqual([]);
});

async function openGraph() {
  await page.getByRole("button", { name: "Home", exact: true }).click({ timeout: 15_000 });
  await page.getByRole("menu", { name: "Home" }).getByRole("menuitem", { name: "Graph" }).click();
  await expect(node(ids.first)).toBeVisible({ timeout: 15_000 });
}

// The window at this size. The headless compositor undoes a size set at once, so it is set until it
// holds (as in phoneWindow).
async function windowSize(width: number, height: number) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await expect
    .poll(async () => {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), { width, height });
      await page.waitForTimeout(300);
      return page.evaluate(() => innerWidth);
    })
    .toBe(width);
}

async function must<T extends { error: unknown }>(query: PromiseLike<T>) {
  const { error } = await query;
  if (error) throw error;
}
