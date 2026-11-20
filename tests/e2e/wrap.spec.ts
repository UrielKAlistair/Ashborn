import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openScreen } from "../openScreen";

// Graph titles wrap, to three lines at most: on data seeded with long titles, every card's title
// row is as tall as its title's lines (so layout and the drawn card agree), no two cards overlap,
// and a rename that adds lines grows the card; a quest's buttons float over its title on hover or
// focus, and stay in its header on touch. On the desktop and in the phone window, in both themes.
// SHOTS=<dir> also saves a screenshot of each.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = process.env.SHOTS;

let app: ElectronApplication;
let page: Page;
let profile: string;
const pageErrors: string[] = [];

const ids = { quest: crypto.randomUUID(), box: crypto.randomUUID(), letter: crypto.randomUUID(), short: crypto.randomUUID(), other: crypto.randomUUID() };
const paragraph =
  "Read the whole of the scholarship's eligibility rules, the fine print on funding, the list of partner universities and the visa notes, then write down every question for the coordinator";

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) {
    const { error: wipeError } = await db.from(table).delete().not("id", "is", null);
    if (wipeError) throw wipeError;
  }
  const step = (title: string, parentId: string, id: string = crypto.randomUUID()) => ({ id, title, parent_id: parentId });
  await must(
    db.from("graph_nodes").insert([
      { id: ids.quest, title: "Apply for the Erasmus Mundus joint master's scholarship in data science", parent_id: null },
      { id: ids.other, title: "Fix the leaking bathroom tap", parent_id: null },
    ]),
  );
  await must(
    db.from("graph_nodes").insert([
      step("Course 1: Mathematics for Data Science, with the weekly graded assignments", ids.quest, ids.box),
      step("Ask Prof. Raghavan for a recommendation letter", ids.quest, ids.letter),
      step(paragraph, ids.quest),
      step("Check https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en", ids.quest),
      step("Short", ids.quest, ids.short),
      step("Buy a washer from the hardware shop on the corner", ids.other),
    ]),
  );
  await must(db.from("graph_nodes").insert([step("Week 1 lectures and the practice questions at the end", ids.box), step("Week 1 graded assignment", ids.box)]));
  await must(db.from("graph_edges").insert({ from_id: ids.letter, to_id: ids.short }));

  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  await launch(true);
});

// The headless display has no pointer that can hover; with `mouse`, Blink is told it has a mouse
async function launch(mouse: boolean) {
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const pointer = mouse ? ["--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"] : [];
  app = await electron.launch({ args: [...pointer, `--user-data-dir=${profile}`, "."], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
}

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const nodes = () => page.locator(".react-flow__node");
const card = (title: string) => nodes().filter({ hasText: title }).last();

// Per card, where its drawn title and its title row disagree, and every pair of cards that overlap
// without one holding the other
function mismatches() {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node"))) {
      const title = node.querySelector<HTMLElement>("p[title]");
      if (!title) continue;
      const quest = node.classList.contains("react-flow__node-quest");
      // A step's title sits in its row; a quest's in a line of its header
      const row = quest ? title.parentElement!.parentElement!.parentElement! : title.parentElement!;
      const line = parseFloat(getComputedStyle(title).lineHeight);
      const lines = Math.round(title.offsetHeight / line);
      const expected = (quest ? 76 : 40) + (lines - 1) * line;
      if (lines > 3 || Math.abs(row.offsetHeight - expected) > 1) found.push(`"${title.title.slice(0, 40)}": ${lines} lines, row ${row.offsetHeight}, expected ${expected.toFixed(1)}`);
    }
    const boxes = Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node")).map((node) => ({ id: node.innerText.slice(0, 30), rect: node.getBoundingClientRect() }));
    const holds = (a: DOMRect, b: DOMRect) => a.left <= b.left + 1 && a.top <= b.top + 1 && a.right >= b.right - 1 && a.bottom >= b.bottom - 1;
    const meet = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        if (meet(a.rect, b.rect) && !holds(a.rect, b.rect) && !holds(b.rect, a.rect)) found.push(`overlap: "${a.id}" and "${b.id}"`);
      }),
    );
    return found;
  });
}

test("graph titles wrap", async () => {
  await test.step("sign in", async () => {
    await windowSize(1280, 800);
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(card("Short")).toBeVisible({ timeout: 15_000 });
  });

  await test.step("long titles wrap, each card as tall as its lines, with no overlap", async () => {
    await expect.poll(mismatches).toEqual([]);
    expect(await linesOf(card("Ask Prof. Raghavan").locator("p[title]"))).toBeGreaterThan(1);
    await shot("desktop-dark");
  });

  await test.step("a paragraph stops at three lines and keeps its whole title on hover", async () => {
    const title = card("Read the whole").locator("p[title]");
    await expect(title).toHaveAttribute("title", paragraph);
    expect(await linesOf(title)).toBe(3);
  });

  await test.step("a quest's buttons show on hover and on keyboard focus, not at rest", async () => {
    const quest = card("Fix the leaking");
    const add = quest.getByTitle("Add a step inside");
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true);
    await page.mouse.move(5, 5);
    await expect.poll(() => opacityOf(add)).toBe("0");
    await quest.locator("p[title]").hover();
    await expect.poll(() => opacityOf(add)).toBe("1");
    await page.mouse.move(5, 5);
    await expect.poll(() => opacityOf(add)).toBe("0");
    await add.focus();
    await expect.poll(() => opacityOf(add)).toBe("1");
    await add.blur();
  });

  await test.step("a rename that adds lines grows the card", async () => {
    // By its id: while it is renamed, its title is in an input, which a text filter does not see
    const short = page.locator(`.react-flow__node[data-id="${ids.short}"]`);
    const before = (await short.boundingBox())!.height;
    await short.locator("p[title]").dblclick();
    await short.locator("input").fill("Short no longer: wait for the letter, then send it with the transcripts");
    await short.locator("input").press("Enter");
    await expect.poll(async () => (await short.boundingBox())!.height).toBeGreaterThan(before);
    await expect.poll(mismatches).toEqual([]);
  });

  await test.step("the light theme wraps the same way", async () => {
    await page.evaluate(() => localStorage.setItem("ashborn-theme", "light"));
    await page.reload();
    await expect(card("Short no longer")).toBeVisible({ timeout: 15_000 });
    await expect.poll(mismatches).toEqual([]);
    await shot("desktop-light");
  });

  await test.step("where nothing can hover, a quest's buttons stay in its header, with room kept for them", async () => {
    await app.close();
    await launch(false);
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
    await windowSize(1280, 800);
    await expect(card("Short no longer")).toBeVisible({ timeout: 15_000 });
    await page.mouse.move(5, 5);
    expect(await opacityOf(card("Fix the leaking").getByTitle("Add a step inside"))).toBe("1");
    await expect.poll(mismatches).toEqual([]);
    await shot("desktop-no-hover");
  });

  for (const theme of ["light", "dark"]) {
    await test.step(`the phone window wraps the same way (${theme})`, async () => {
      await page.evaluate((stored) => localStorage.setItem("ashborn-theme", stored), theme);
      await windowSize(412, 860);
      await page.reload();
      await openScreen(page, "Graph");
      await expect(card("Short no longer")).toBeVisible({ timeout: 15_000 });
      await expect.poll(mismatches).toEqual([]);
      await shot(`phone-${theme}`);
    });
  }

  expect(pageErrors).toEqual([]);
});

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

const linesOf = (title: Locator) => title.evaluate((element) => Math.round((element as HTMLElement).offsetHeight / parseFloat(getComputedStyle(element).lineHeight)));
// A card's floating buttons show and hide together, by their row's opacity
const opacityOf = (button: Locator) => button.evaluate((element) => getComputedStyle(element.parentElement!).opacity);

async function shot(name: string) {
  if (shots) await page.screenshot({ path: path.join(shots, `wrap-${name}.png`) });
}

async function must<T extends { error: unknown }>(query: PromiseLike<T>) {
  const { error } = await query;
  if (error) throw error;
}
