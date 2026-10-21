import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// One walk through the home graph in a fresh profile, signed in as the test user: threads,
// steps, links, ticking, hiding, XP, renaming, deleting, live changes from elsewhere, and state
// surviving a reload.

// The same account the app signs into, used to reset its data and to make changes "elsewhere"
const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

let app: ElectronApplication;
let page: Page;
let profile: string;
const pageErrors: string[] = [];

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  // Steps, links and level-ups go with their threads
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

// Where a dot is once the layout has stopped moving it
async function settledBox(handle: Locator) {
  let previous = await handle.boundingBox();
  for (;;) {
    await page.waitForTimeout(150);
    const box = await handle.boundingBox();
    if (box && previous && box.x === previous.x && box.y === previous.y) return box;
    previous = box;
  }
}

// Drags from one step's outgoing dot to another's incoming dot in small moves, as a hand would
async function link(from: string, to: string) {
  const source = await settledBox(card(from).locator(".react-flow__handle.source"));
  const target = await settledBox(card(to).locator(".react-flow__handle.target"));
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
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
    await expect(page.getByText("Start a thread")).toBeVisible({ timeout: 15_000 });
  });

  await test.step("the empty-state box creates a thread", async () => {
    const first = page.getByPlaceholder("Name your first thread (Enter)");
    await first.fill("Deep Learning");
    await first.press("Enter");
    await expect(nodes()).toHaveCount(1);
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

  await test.step("dragging links two steps; dragging back removes the link", async () => {
    await link("Backprop by hand", "Implement an MLP");
    await expect(edges()).toHaveCount(1);
    await link("Implement an MLP", "Backprop by hand");
    await expect(edges()).toHaveCount(0);
    await link("Backprop by hand", "Implement an MLP");
    await expect(edges()).toHaveCount(1);
  });

  await test.step("Up next lists only ready steps", async () => {
    await expect(upNext()).toContainText("Backprop by hand");
    await expect(upNext()).toContainText("CNN basics");
    await expect(upNext()).not.toContainText("Implement an MLP");
  });

  await test.step("a ticked step stays greyed, its outgoing link dashes", async () => {
    await card("Backprop by hand").getByTitle("Mark done").click();
    await expect(card("Backprop by hand").getByTitle("Mark not done")).toBeVisible();
    await expect(page.locator(".react-flow__edge-path").first()).toHaveAttribute("style", /dasharray/);
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

  await test.step("level-up and ticks train the thread's stats by weight, and count toward today's progress", async () => {
    await card("Deep Learning").getByTitle("Options").click();
    await page.getByLabel("INT weight").fill("1.5");
    await page.getByLabel("INT weight").press("Enter");
    await page.getByLabel("CHR weight").fill("0.5");
    await page.getByLabel("CHR weight").press("Enter");
    await page.getByRole("radio", { name: "violet" }).click();
    await expect(page.getByRole("radio", { name: "violet" })).toHaveAttribute("aria-checked", "true");
    await expect(card("Deep Learning").locator(".bg-violet-400")).toHaveCount(1);
    await card("Deep Learning").getByTitle("Level up: log a session of progress").click();
    // 20 xp in the thread: one tick and one level-up
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
    await card("CNN basics").getByTitle("Mark done").first().click();
    await expect(card("Convolution as a matrix")).toBeVisible();
    await card("CNN basics").getByTitle("Mark not done").first().click();
    await card("CNN basics").getByTitle("Hide steps").click();
    await expect(nodes().filter({ hasText: "Convolution as a matrix" })).toHaveCount(0);
    await card("CNN basics").getByTitle("Add a step inside").click();
    await expect(card("Convolution as a matrix")).toBeVisible();
    await addInput().press("Escape");
  });

  await test.step("double-click renames steps and threads; the thread menu has no rename field", async () => {
    await rename(card("Implement an MLP").getByText("Implement an MLP"), page.locator(".react-flow__node-step input"), "Implement an MLP in numpy");
    await expect(card("MLP in numpy")).toBeVisible();
    await rename(card("Deep Learning").getByText("Deep Learning"), page.locator(".react-flow__node-thread input"), "Deep Learning II");
    await expect(page.locator(".react-flow__node-thread", { hasText: "Deep Learning II" })).toBeVisible();
    await card("Deep Learning II").getByTitle("Options").click();
    await expect(page.locator(".react-flow__node-toolbar input:not([type=number])")).toHaveCount(0);
    await expect(page.locator(".react-flow__node-toolbar").getByRole("button", { name: "Delete" })).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  await test.step("offline, a quick add and a tick wait on the device, then sync", async () => {
    await page.context().setOffline(true);
    await card("CNN basics").getByTitle("Add a step inside").click();
    await addInput().fill("Offline step");
    await addInput().press("Enter");
    await addInput().press("Escape");
    await card("Offline step").getByTitle("Mark done").click();
    await expect(page.getByText("2 changes will sync when you're back online")).toBeVisible();

    await page.context().setOffline(false);
    await expect(page.getByText(/will sync/)).toHaveCount(0, { timeout: 15_000 });
    const { data } = await db.from("graph_nodes").select("completed_at").eq("title", "Offline step").single();
    expect(data?.completed_at).toBeTruthy();
  });

  await test.step("a step added elsewhere appears live", async () => {
    const { data: thread } = await db.from("graph_nodes").select("id").eq("title", "Deep Learning II").single();
    await db.from("graph_nodes").insert({ title: "Added by an agent", parent_id: thread!.id });
    await expect(card("Added by an agent")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("a step's × asks first, then deletes", async () => {
    await expect(card("MLP in numpy").getByTitle("Options")).toHaveCount(0);
    await card("MLP in numpy").getByTitle("Delete").click();
    await expect(card("MLP in numpy").getByText("Delete?")).toBeVisible();
    await card("MLP in numpy").getByTitle("Click again to delete").click();
    await expect(nodes().filter({ hasText: "MLP" })).toHaveCount(0);
  });

  await test.step("a hidden thread comes back from Threads after a reload", async () => {
    await card("Deep Learning II").getByTitle("Options").click();
    await page.getByRole("button", { name: "Hide thread" }).click();
    await expect(page.getByText("All threads are hidden")).toBeVisible();
    await page.reload();
    await expect(page.getByText("All threads are hidden")).toBeVisible();
    await page.getByRole("button", { name: /Threads/ }).click();
    await page.locator("label", { hasText: "Deep Learning" }).locator("input").click();
    await expect(card("Deep Learning II")).toBeVisible();
  });

  await test.step("desktop: dragging a thread and resizing a step stick, and survive a reload", async () => {
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 400 } }); // closes the Threads list over the canvas
    const thread = page.locator(".react-flow__node-thread").first();
    const before = (await thread.boundingBox())!;
    await page.mouse.move(before.x + 120, before.y + 50);
    await page.mouse.down();
    await page.mouse.move(before.x + 220, before.y + 130, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await db.from("graph_nodes").select("x").eq("title", "Deep Learning II").single()).data?.x)
      .not.toBeNull();

    const step = card("Added by an agent");
    const grip = (await step.locator(".react-flow__resize-control").boundingBox())!;
    const stepBefore = (await step.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 80, grip.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await db.from("graph_nodes").select("width").eq("title", "Added by an agent").single()).data?.width)
      .toBeGreaterThan(stepBefore.width);

    await page.reload();
    await expect(card("Added by an agent")).toBeVisible();
    const after = (await card("Added by an agent").boundingBox())!;
    expect(after.width).toBeGreaterThan(stepBefore.width + 20);
  });

  await test.step("Reset layout asks first, then puts every box back to automatic placement", async () => {
    const placed = async () => (await db.from("graph_nodes").select("id").not("x", "is", null)).data?.length;
    expect(await placed()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Reset layout" }).click();
    expect(await placed()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Reset every box?" }).click();
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
    const { data } = await db.from("alarms").select("enabled, time, weekdays, kind").eq("label", "Wake up").single();
    expect(data).toEqual({ enabled: false, time: "06:00:00", weekdays: ["Mon", "Tue"], kind: "situps" });
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
      const { data } = await db.from(table).select("id").eq("title", title);
      expect(data).toEqual([]);
    }
  });

  await test.step("a phone-sized window opens on today's list; Home's menu holds the graph and the character", async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.unmaximize();
      window.setSize(400, 860);
    });
    await expect(page.locator(".react-flow")).toHaveCount(0);
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
