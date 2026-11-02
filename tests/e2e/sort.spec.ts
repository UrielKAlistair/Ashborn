import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// Brain dump and sorting: a pasted list makes one Inbox item per line; Sort walks the Inbox one item
// at a time without the graph, by click and by key, and keeps Focus's keys from firing meanwhile.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/lower-cost/shots";

let app: ElectronApplication;
let page: Page;
let profile: string;
let userId: string;
const work = crypto.randomUUID();
const report = crypto.randomUUID();

test.beforeAll(async () => {
  const { data, error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  userId = data.user.id;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) await db.from(table).delete().not("id", "is", null);
  const { error: questError } = await db.from("graph_nodes").insert({ id: work, title: "Work", parent_id: null, priority: 1 });
  if (questError) throw questError;
  const { error: stepError } = await db.from("graph_nodes").insert({ id: report, title: "Write report", parent_id: work });
  if (stepError) throw stepError;

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

const field = () => page.getByLabel("Capture a thought");
const card = () => page.getByRole("region", { name: "Sort the Inbox" });
const focus = () => page.getByRole("region", { name: "Now" });
const sortButton = (count: number) => page.getByRole("button", { name: `Sort ${count}`, exact: true });
const rowOf = async (title: string) => {
  const { data, error } = await db.from("graph_nodes").select("parent_id, completed_at").eq("title", title).maybeSingle();
  if (error) throw error;
  return data;
};
const parentOf = async (title: string) => (await rowOf(title))?.parent_id;
const paste = (text: string) =>
  field().evaluate((input, pasted) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text", pasted);
    return input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, text);
// Bare keys go to the page: nothing is focused, as after a click on empty panel
const noFocus = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("brain dump and sort", async () => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(focus()).toContainText("Write report", { timeout: 20_000 });

  await test.step("thoughts keep their order while a slow connection is still making the Inbox", async () => {
    let held = false;
    await page.route("**/rest/v1/graph_nodes*", async (route) => {
      if (!held && route.request().method() === "POST") {
        held = true;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });
    for (const thought of ["Thought one", "Thought two"]) {
      await field().fill(thought);
      await field().press("Enter");
    }
    await expect(sortButton(2)).toBeVisible();
    const order = async () => (await db.from("graph_nodes").select("title").eq("parent_id", userId).order("created_at")).data?.map(({ title }) => title);
    await expect.poll(order, { timeout: 8000 }).toEqual(["Thought one", "Thought two"]);
    await page.unroute("**/rest/v1/graph_nodes*");
    await db.from("graph_nodes").delete().eq("parent_id", userId);
    await expect(sortButton(2)).toHaveCount(0);
  });

  await test.step("a pasted list makes one item per line, marks dropped; one line stays in the field", async () => {
    expect(await paste("Only one line\n")).toBe(true); // not cancelled: the browser fills the field
    await expect(sortButton(1)).toHaveCount(0);

    expect(await paste("- Call the bank\n\n2. Book a dentist\n[ ] Plan the holiday\nRead that paper\nPick a gift\nFix the tap")).toBe(false);
    await expect(sortButton(6)).toBeVisible();
    await expect(field()).toHaveValue("");
    await expect.poll(() => parentOf("Fix the tap")).toBe(userId);
    await expect.poll(() => parentOf("Call the bank")).toBe(userId);
  });

  await test.step("Sort shows the oldest; Skip passes it, and it comes round again", async () => {
    await sortButton(6).click();
    await expect(card()).toContainText("Call the bank");
    await expect(card()).toContainText("1 of 6");
    await expect(card().getByLabel("Move to…").getByRole("option", { name: "Its own quest" })).toHaveCount(0); // the button says it
    await expect(card().getByRole("button", { name: "Delete" })).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `${shots}/sort-ember.png` });

    await card().getByRole("button", { name: "Skip" }).click();
    await expect(card()).toContainText("Book a dentist");
  });

  await test.step("a priority is optional: it stays on the item, by click or key, and goes with it when moved", async () => {
    const priorityOf = async (title: string) => (await db.from("graph_nodes").select("priority").eq("title", title).single()).data?.priority;
    const chips = card().getByRole("group", { name: "Priority for Book a dentist" });
    await chips.getByRole("button", { name: "P2" }).click();
    await expect.poll(() => priorityOf("Book a dentist")).toBe(2);
    await expect(chips.getByRole("button", { name: "P2" })).toHaveAttribute("aria-pressed", "true");
    await expect(card()).toContainText("Book a dentist"); // doesn't move on
    await expect(page.getByRole("status").filter({ hasText: "P2: Book a dentist" })).toBeVisible();
    await page.screenshot({ path: `${shots}/sort-priority.png` });

    await chips.getByRole("button", { name: "P2" }).click(); // pressed again, it comes off
    await expect.poll(() => priorityOf("Book a dentist")).toBeNull();
    await noFocus();
    await page.keyboard.press("3");
    await expect.poll(() => priorityOf("Book a dentist")).toBe(3);
    await expect(chips.getByRole("button", { name: "P3" })).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("Move to… sorts it and the next comes up; Its own quest; Delete asks first", async () => {
    await card().getByLabel("Move to…").selectOption({ label: "Work" });
    await expect.poll(() => parentOf("Book a dentist")).toBe(work);
    expect((await db.from("graph_nodes").select("priority").eq("title", "Book a dentist").single()).data?.priority).toBe(3);
    await expect(card()).toContainText("Plan the holiday");
    await expect(card()).toContainText("of 5");

    await card().getByRole("button", { name: "Its own quest" }).click();
    await expect.poll(() => parentOf("Plan the holiday")).toBeNull();
    await expect(card()).toContainText("Read that paper");

    await card().getByRole("button", { name: "Delete" }).click();
    await expect(card()).toContainText("Read that paper"); // still here: only asked
    await page.screenshot({ path: `${shots}/sort-delete-ask.png` });
    await card().getByRole("button", { name: "Delete?" }).click();
    await expect.poll(async () => await rowOf("Read that paper")).toBeNull();
    await expect(card()).toContainText("Pick a gift");
  });

  await test.step("Split adds steps inside and moves on; cancelling stays", async () => {
    await card().getByRole("button", { name: "Split it" }).click();
    await card().getByRole("button", { name: "Cancel" }).click();
    await expect(card()).toContainText("Pick a gift");

    await card().getByRole("button", { name: "Split it" }).click();
    await card().getByLabel("Steps, one per line").fill("Ask what they like\nOrder it");
    await page.screenshot({ path: `${shots}/sort-split.png` });
    await card().getByRole("button", { name: "Add steps" }).click();
    await expect(card()).toContainText("Fix the tap");
    await expect.poll(async () => (await db.from("graph_nodes").select("id").eq("title", "Ask what they like")).data?.length).toBe(1);
  });

  await test.step("keys work, and Focus's don't fire underneath; typing in the field isn't a key", async () => {
    await noFocus();
    await page.keyboard.press("n"); // skip; Focus's "not now" has one step, and D must not tick it
    await expect(card()).toContainText("Call the bank");
    await page.keyboard.press("d");
    await page.waitForTimeout(300);
    expect((await rowOf("Write report"))?.completed_at).toBeNull();

    await field().fill("");
    await field().pressSequentially("xqn");
    await expect(field()).toHaveValue("xqn");
    await expect(card()).toContainText("Call the bank");
    await field().fill("");

    await noFocus();
    await page.keyboard.press("x");
    await expect(card().getByRole("button", { name: "Delete?" })).toBeVisible();
    await page.keyboard.press("x");
    await expect.poll(async () => await rowOf("Call the bank")).toBeNull();
    await expect(card()).toContainText("Pick a gift"); // the split one, its round begun again
    await expect(card()).toContainText("2 steps inside");

    await page.keyboard.press("q");
    await expect.poll(() => parentOf("Pick a gift")).toBeNull();
    await expect(card()).toContainText("Fix the tap");

    await page.keyboard.press("s");
    await expect(card().getByLabel("Steps, one per line")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(card().getByLabel("Steps, one per line")).toHaveCount(0);
    await expect(card()).toBeVisible();

    // A native list left open on the headless display stops the page drawing, so only the asking is checked
    await page.evaluate(() => {
      HTMLSelectElement.prototype.showPicker = function () {
        document.body.dataset.pickerAsked = "yes";
      };
    });
    await noFocus();
    await page.keyboard.press("m");
    await expect(card().getByLabel("Move to…")).toBeFocused();
    await expect(page.locator("body")).toHaveAttribute("data-picker-asked", "yes");
    await noFocus();
    await page.keyboard.press("Escape");
    await expect(card()).toHaveCount(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true); // Escape closed the card, not the window
  });

  await test.step("sorting the last item closes the card, and the next capture doesn't reopen it", async () => {
    await sortButton(1).click();
    await card().getByLabel("Move to…").selectOption({ label: "Work" });
    await expect(card()).toHaveCount(0);
    await field().fill("One more");
    await field().press("Enter");
    await expect(sortButton(1)).toBeVisible();
    await expect(card()).toHaveCount(0);
  });

  await test.step("it reads in every theme, and on the phone", async () => {
    await field().fill("A second thought");
    await field().press("Enter");
    await sortButton(2).click();
    for (const theme of ["light", "meadow"]) {
      await page.evaluate((name) => document.documentElement.setAttribute("data-theme", name), theme);
      await page.screenshot({ path: `${shots}/sort-${theme}.png` });
    }
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

    await phoneWindow(app, page);
    await sortButton(2).click(); // the phone layout is a new Today panel
    await expect(card()).toBeVisible();
    await page.screenshot({ path: `${shots}/sort-phone.png` });
    const del = (await card().getByRole("button", { name: "Delete" }).boundingBox())!;
    expect(del.x + del.width).toBeLessThanOrEqual(400);
    await card().getByRole("button", { name: "Its own quest" }).click();
    await expect.poll(() => parentOf("One more")).toBeNull();
    await expect(card()).toContainText("A second thought");
  });

  expect(pageErrors).toEqual([]);
});
