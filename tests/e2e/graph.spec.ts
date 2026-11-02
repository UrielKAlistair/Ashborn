import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// One walk through the home graph in a fresh profile, signed in as the test user: quests,
// steps, links, ticking, hiding, XP, renaming, deleting, live changes from elsewhere, and state
// surviving a reload.

const SETTLE_LIMIT_MS = 10_000;

// The same account the app signs into, used to reset its data and to make changes "elsewhere"
const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

let app: ElectronApplication;
let page: Page;
let profile: string;
const pageErrors: string[] = [];

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  // Steps, links and level-ups go with their quests
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) {
    const { error: wipeError } = await db.from(table).delete().not("id", "is", null);
    if (wipeError) throw wipeError;
  }

  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE; // set in some shells; it makes Electron start as plain Node
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups"); // the test user's data stays out of the real backups
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Chromium logs the requests the offline step makes fail on purpose; those are not app errors
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("ERR_INTERNET_DISCONNECTED")) pageErrors.push(message.text());
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const nodes = () => page.locator(".react-flow__node");
const card = (title: string) => nodes().filter({ hasText: title }).last();
const edges = () => page.locator(".react-flow__edge");
const upNext = () => page.locator("section", { hasText: "Up next" }).last();
const addInput = () => page.getByPlaceholder("Step name, Enter to add");
const windowVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());

// Where a box or dot is once the layout has left it still for 600 ms: after a reload the layout
// worker starts cold, so a shorter pause can come before it has placed anything. A box that never
// settles fails the step here rather than running on to the test's timeout.
async function settledBox(handle: Locator) {
  const deadline = Date.now() + SETTLE_LIMIT_MS;
  let previous = await handle.boundingBox();
  for (let still = 0; still < 4; ) {
    if (Date.now() > deadline) throw new Error(`Not still after ${SETTLE_LIMIT_MS} ms: ${handle}, last box ${JSON.stringify(previous)}`);
    await page.waitForTimeout(150);
    const box = await handle.boundingBox();
    const same = box && previous && box.x === previous.x && box.y === previous.y && box.width === previous.width && box.height === previous.height;
    still = same ? still + 1 : 0;
    previous = box;
  }
  return previous!;
}

// Drags from one step's outgoing dot to another's incoming dot in small moves, as a hand would
async function link(from: string, to: string) {
  await dragDot(card(from).locator(".react-flow__handle.source"), card(to).locator(".react-flow__handle.target"));
}

// Drags a link's head, at the incoming dot of `to`, back onto the outgoing dot of `from`
async function dragHeadBack(from: string, to: string) {
  await dragDot(card(to).locator(".react-flow__handle.target"), card(from).locator(".react-flow__handle.source"));
}

async function dragDot(start: Locator, end: Locator) {
  const a = await settledBox(start);
  const b = await settledBox(end);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function rename(title: Locator, input: Locator, value: string) {
  await title.dblclick();
  await input.fill(value);
  await input.press("Enter");
}

test("home graph", async () => {
  await test.step("sign in", async () => {
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Start a quest: something")).toBeVisible({ timeout: 15_000 });
  });

  await test.step("the empty-state box creates a quest", async () => {
    const first = page.getByPlaceholder("Name your first quest (Enter)");
    await first.fill("Deep Learning");
    await first.press("Enter");
    await expect(nodes()).toHaveCount(1);
    // A new quest opens on Split, for its first steps; Escape puts it away
    await expect(page.getByLabel("Steps, one per line")).toBeFocused();
    await page.getByLabel("Steps, one per line").press("Escape");
    await expect(page.getByLabel("Steps, one per line")).toHaveCount(0);
  });

  await test.step("the green + adds steps and stays open; Escape closes it, not the window", async () => {
    await card("Deep Learning").getByTitle("Add a step inside").click();
    for (const title of ["Backprop by hand", "Implement an MLP", "CNN basics"]) {
      await addInput().fill(title);
      await addInput().press("Enter");
      await expect(card(title)).toBeVisible();
    }
    await expect(nodes()).toHaveCount(4);
    await addInput().press("Escape");
    await expect(addInput()).toHaveCount(0);
    expect(await windowVisible()).toBe(true);
  });

  await test.step("dragging links two steps; dragging back, from either end, removes the link", async () => {
    await link("Backprop by hand", "Implement an MLP");
    await expect(edges()).toHaveCount(1);
    await link("Implement an MLP", "Backprop by hand");
    await expect(edges()).toHaveCount(0);
    await link("Backprop by hand", "Implement an MLP");
    await expect(edges()).toHaveCount(1);
    await dragHeadBack("Backprop by hand", "Implement an MLP");
    await expect(edges()).toHaveCount(0);
    await link("Backprop by hand", "Implement an MLP");
    await expect(edges()).toHaveCount(1);
  });

  await test.step("Up next holds nothing until a priority covers the steps, then only ready ones", async () => {
    await expect(upNext()).not.toContainText("Backprop by hand");
    await card("Deep Learning").getByTitle("Options").click();
    await page.getByRole("radio", { name: "Priority 1" }).click();
    await card("Deep Learning").getByTitle("Options").click();
    await page.getByRole("button", { name: /Show (all \d+ ready|the list)/ }).click(); // the whole to-do, not only Now
    await expect(upNext()).toContainText("Backprop by hand");
    await expect(upNext()).toContainText("CNN basics");
    await expect(upNext()).not.toContainText("Implement an MLP");
  });

  await test.step("a ticked step stays greyed, its outgoing link dashes", async () => {
    await card("Backprop by hand").getByTitle("Mark done").click();
    await expect(card("Backprop by hand").getByTitle("Mark not done")).toBeVisible();
    await expect(page.locator(".react-flow__edge-path").first()).toHaveAttribute("style", /dasharray/);
    // The tick shows before the server has it; the next step reloads
    await expect.poll(async () => (await db.from("graph_nodes").select("completed_at").eq("title", "Backprop by hand").single()).data?.completed_at).toBeTruthy();
  });

  await test.step("the eye hides and shows a box's steps, and remembers across reloads", async () => {
    await card("Deep Learning").getByTitle("Hide steps").click();
    await expect(nodes()).toHaveCount(1);
    await page.reload();
    await expect(nodes()).toHaveCount(1);
    await card("Deep Learning").getByTitle("Show steps").click();
    await expect(nodes()).toHaveCount(4);
  });

  await test.step("unticking reopens a step; ticking it readies its dependent", async () => {
    await card("Backprop by hand").getByTitle("Mark not done").click();
    await expect(card("Backprop by hand").getByTitle("Mark done")).toBeVisible();
    await card("Backprop by hand").getByTitle("Mark done").click();
    await expect(upNext()).toContainText("Implement an MLP");
  });

  await test.step("level-up and ticks train the quest's stats by weight, and count toward today's progress", async () => {
    await card("Deep Learning").getByTitle("Options").click();
    await page.getByLabel("INT weight").fill("1.5");
    await page.getByLabel("INT weight").press("Enter");
    await page.getByLabel("CHR weight").fill("0.5");
    await page.getByLabel("CHR weight").press("Enter");
    await page.getByRole("radio", { name: "violet" }).click();
    await expect(page.getByRole("radio", { name: "violet" })).toHaveAttribute("aria-checked", "true");
    await expect(card("Deep Learning").locator(".fill-violet-400")).toHaveCount(1);
    await card("Deep Learning").getByTitle("Level up: log a session of progress").click();
    // 20 xp in the quest: one tick and one level-up
    await expect(page.locator("dl div[title='30 xp']", { hasText: "INT" })).toHaveCount(1);
    await expect(page.locator("dl div[title='10 xp']", { hasText: "CHR" })).toHaveCount(1);
    await expect(page.getByText("2 steps of progress today")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("INT weight")).toHaveCount(0);
    expect(await windowVisible()).toBe(true);
  });

  await test.step("a step inside a step: the inner one is up next, the outer one isn't", async () => {
    await card("CNN basics").getByTitle("Add a step inside").click();
    await addInput().fill("Convolution as a matrix product");
    await addInput().press("Enter");
    await expect(card("Convolution as a matrix")).toBeVisible();
    await addInput().press("Escape");
    await expect(upNext()).toContainText("Convolution as a matrix product");
    await expect(upNext().getByText("CNN basics", { exact: true })).toHaveCount(0);
  });

  await test.step("ticking a box keeps its inner steps; the eye and + work on nested boxes", async () => {
    // Both reach the server before the step ends (the tick first, then the untick, which waits
    // behind it on the same row), so the offline step doesn't catch the untick on its way
    const boxDone = async () => (await db.from("graph_nodes").select("completed_at").eq("title", "CNN basics").single()).data?.completed_at;
    await card("CNN basics").getByTitle("Mark done").first().click();
    await expect(card("Convolution as a matrix")).toBeVisible();
    await expect.poll(boxDone).not.toBeNull();
    await card("CNN basics").getByTitle("Mark not done").first().click();
    await expect.poll(boxDone).toBeNull();
    await card("CNN basics").getByTitle("Hide steps").click();
    await expect(nodes().filter({ hasText: "Convolution as a matrix" })).toHaveCount(0);
    await card("CNN basics").getByTitle("Add a step inside").click();
    await expect(card("Convolution as a matrix")).toBeVisible();
    await addInput().press("Escape");
  });

  await test.step("double-click renames steps and quests; the quest menu has no rename field", async () => {
    await rename(card("Implement an MLP").getByText("Implement an MLP"), page.locator(".react-flow__node-step input"), "Implement an MLP in numpy");
    await expect(card("MLP in numpy")).toBeVisible();
    await rename(card("Deep Learning").getByText("Deep Learning"), page.locator(".react-flow__node-quest input"), "Deep Learning II");
    await expect(page.locator(".react-flow__node-quest", { hasText: "Deep Learning II" })).toBeVisible();
    await card("Deep Learning II").getByTitle("Options").click();
    await expect(page.locator(".react-flow__node-toolbar input:not([type=number])")).toHaveCount(0);
    await expect(page.locator(".react-flow__node-toolbar").getByRole("button", { name: "Delete" })).toHaveCount(1);
    await page.keyboard.press("Escape");
    // Renames show before the server has them; the next step counts what goes offline
    const saved = async () => (await db.from("graph_nodes").select("title").in("title", ["Implement an MLP in numpy", "Deep Learning II"])).data?.length;
    await expect.poll(saved).toBe(2);
  });

  await test.step("offline, a quick add and a tick wait on the device, then sync", async () => {
    await page.context().setOffline(true);
    await card("CNN basics").getByTitle("Add a step inside").click();
    await addInput().fill("Offline step");
    await addInput().press("Enter");
    await addInput().press("Escape");
    // The app learns it is offline when the add fails to send; a tick before that can be lost
    await expect(page.getByText("1 change will sync when you're back online")).toBeVisible();
    await card("Offline step").getByTitle("Mark done").click();
    await expect(page.getByText("2 changes will sync when you're back online")).toBeVisible();

    await page.context().setOffline(false);
    await expect(page.getByText(/will sync/)).toHaveCount(0, { timeout: 15_000 });
    const { data } = await db.from("graph_nodes").select("completed_at").eq("title", "Offline step").single();
    expect(data?.completed_at).toBeTruthy();
  });

  await test.step("a step added elsewhere appears live", async () => {
    const { data: quest } = await db.from("graph_nodes").select("id").eq("title", "Deep Learning II").single();
    await db.from("graph_nodes").insert({ title: "Added by an agent", parent_id: quest!.id });
    await expect(card("Added by an agent")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("a step's × asks first, then deletes", async () => {
    await expect(card("MLP in numpy").getByTitle("Options")).toHaveCount(0);
    await card("MLP in numpy").getByTitle("Delete").click();
    await expect(card("MLP in numpy").getByText("Delete?")).toBeVisible();
    await card("MLP in numpy").getByTitle("Click again to delete").click();
    await expect(nodes().filter({ hasText: "MLP" })).toHaveCount(0);
  });

  await test.step("a hidden quest comes back from Quests after a reload", async () => {
    await card("Deep Learning II").getByTitle("Options").click();
    await page.getByRole("button", { name: "Hide quest" }).click();
    await expect(page.getByText("All quests are hidden")).toBeVisible();
    await expect.poll(async () => (await db.from("graph_nodes").select("active").eq("title", "Deep Learning II").single()).data?.active).toBe(false);
    await page.reload();
    await expect(page.getByText("All quests are hidden")).toBeVisible();
    await page.getByRole("button", { name: /Quests/ }).click();
    await page.locator("label", { hasText: "Deep Learning" }).locator("input").click();
    await expect(card("Deep Learning II")).toBeVisible();
  });

  await test.step("desktop: dragging a quest sticks, and survives a reload", async () => {
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 400 } }); // closes the Quests list over the canvas
    const quest = page.locator(".react-flow__node-quest").first();
    const before = await settledBox(quest);
    await page.mouse.move(before.x + 120, before.y + 50);
    await page.mouse.down();
    await page.mouse.move(before.x + 220, before.y + 130, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await db.from("graph_nodes").select("x").eq("title", "Deep Learning II").single()).data?.x)
      .not.toBeNull();
    // The canvas position, not the screen one: a reload fits the view again
    const dropped = await quest.evaluate((element) => element.style.transform);

    await page.reload();
    await expect(card("Deep Learning II")).toBeVisible();
    expect(await page.locator(".react-flow__node-quest").first().evaluate((element) => element.style.transform)).toBe(dropped);
  });

  await test.step("a quest's steps stay put until it is unlocked; its Reset layout leaves the quest in place", async () => {
    const x = async (title: string) => (await db.from("graph_nodes").select("x").eq("title", title).single()).data?.x;
    const dragStep = async () => {
      const box = await settledBox(card("Added by an agent"));
      await page.mouse.move(box.x + 60, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + box.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
    };

    await dragStep();
    await page.waitForTimeout(1000);
    expect(await x("Added by an agent")).toBeNull();

    await card("Deep Learning II").getByTitle(/^Unlock/).click();
    await dragStep();
    await expect.poll(() => x("Added by an agent")).not.toBeNull();

    await card("Deep Learning II").getByTitle("Options").click();
    await page.getByRole("button", { name: /Reset layout: arrange its steps/ }).click();
    await expect.poll(() => x("Added by an agent")).toBeNull();
    expect(await x("Deep Learning II")).not.toBeNull();
    await card("Deep Learning II").getByTitle(/^Lock/).click();
  });

  await test.step("Reset layout asks first, then puts every box back to automatic placement", async () => {
    const placed = async () => (await db.from("graph_nodes").select("id").not("x", "is", null)).data?.length;
    expect(await placed()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Reset layout" }).click();
    expect(await placed()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Also steps in every box" }).click();
    await expect.poll(placed).toBe(0);
  });

  await test.step("alarms: a quick one, a recurring one with a challenge, switched off and on", async () => {
    await page.getByRole("button", { name: "Alarms" }).click();
    await page.getByRole("button", { name: "In 30 min" }).click();
    await expect(page.getByText(/^once, /)).toBeVisible();

    await page.locator('input[type="time"]').fill("06:00");
    await page.getByPlaceholder("Label (optional)").fill("Wake up");
    for (const day of ["Mo", "Tu"]) await page.getByRole("button", { name: day, exact: true }).click();
    await page.locator("select").selectOption("situps");
    await page.getByRole("button", { name: /^Set/ }).click();
    await expect(page.getByText("Mon Tue · 15 sit-ups")).toBeVisible();

    const wake = page.getByRole("switch", { name: "Wake up on" });
    await wake.click();
    await expect(wake).toHaveAttribute("aria-checked", "false");
    // The switch shows the change before the server has it
    const saved = async () => (await db.from("alarms").select("enabled, time, weekdays, kind").eq("label", "Wake up").single()).data;
    await expect.poll(saved).toEqual({ enabled: false, time: "06:00:00", weekdays: ["Mon", "Tue"], kind: "situps" });
    await page.getByRole("button", { name: "Home" }).click();
  });

  await test.step("a routine's or deadline's × warns first, then deletes", async () => {
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    await db.from("routines").insert({ title: "Stretch", weekdays });
    await db.from("deadlines").insert({ title: "File taxes", due_date: new Date().toLocaleDateString("en-CA") });
    for (const [title, warning, table] of [
      ["Stretch", "Delete this routine and its ticks?", "routines"],
      ["File taxes", "Delete this deadline?", "deadlines"],
    ]) {
      const row = page.locator(".group", { hasText: title });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.hover();
      await row.getByTitle("Delete").click();
      await row.getByRole("button", { name: warning }).click();
      await expect(page.getByText(title)).toHaveCount(0);
      await expect.poll(async () => (await db.from(table).select("id").eq("title", title)).data).toEqual([]);
    }
  });

  await test.step("a phone-sized window opens on today's list; Home's menu holds the graph and the character", async () => {
    await phoneWindow(app, page);
    // The graph may already be built, but only hidden and inert over the list (decision 91)
    await expect(page.locator(".react-flow:not([inert] *)")).toHaveCount(0);
    await expect(upNext()).toBeVisible();

    const openScreen = async (section: string, screen: string) => {
      await page.getByRole("button", { name: section, exact: true }).click();
      await page.getByRole("menu", { name: section }).getByRole("menuitem", { name: screen }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
    };

    await openScreen("Home", "Character");
    await expect(page.getByText("STR")).toBeVisible();
    await expect(upNext()).toBeHidden();

    await openScreen("Home", "Graph");
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.locator(".react-flow__handle").first()).toBeHidden(); // no linking by hand on the phone
    await card("Deep Learning II").getByRole("button", { name: "Actions" }).click();
    await page.getByRole("button", { name: "Add a step inside" }).click();
    await addInput().fill("Added on the phone");
    await addInput().press("Enter");
    await expect(card("Added on the phone")).toBeVisible();

    await openScreen("Home", "To-do");
    await expect(upNext()).toContainText("Added on the phone");

    await openScreen("Kitchen", "Stocks");
    await expect(page.getByRole("heading", { name: "Stocks" })).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
