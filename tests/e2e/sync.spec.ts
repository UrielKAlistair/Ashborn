import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApi } from "../../src/lib/api";
import { today } from "../../src/shared/dates";

// Two devices on one account: device A is the desktop app, taken offline and back; device B is
// the API called from here, as the phone or the agent would. Per field the change made later
// wins, whichever is sent later; stock hand edits are readings, cooking is an event; an edit of
// something deleted elsewhere is named in the notice.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const deviceB = createApi(db);
const HOUR_MS = 60 * 60 * 1000;

let app: ElectronApplication;
let page: Page;
let profile: string;
const pageErrors: string[] = [];

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms", "meals", "default_meals", "recipes", "stock_items"]) {
    const { error: wipeError } = await db.from(table).delete().not("id", "is", null);
    if (wipeError) throw wipeError;
  }

  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups"); // the test user's data stays out of the real backups
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Chromium logs the requests made offline on purpose; those are not app errors
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("ERR_INTERNET_DISCONNECTED")) pageErrors.push(message.text());
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const card = (title: string) => page.locator(".react-flow__node").filter({ hasText: title }).last();
const stock = (name: string) => page.getByRole("group", { name, exact: true });
const amountLabel = (name: string) => stock(name).locator("p.text-right");
const meal = (slot: string) => page.getByRole("group", { name: `${slot} on ${today()}` });

async function goOffline() {
  await page.context().setOffline(true);
}

// Back online, once the change made offline is queued: the queue is sent, then the data reloaded
async function goOnline() {
  await expect(page.getByText(/will sync when you're back online/)).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText(/will sync/)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(/^Offline/)).toHaveCount(0, { timeout: 15_000 });
}

async function rename(title: Locator, value: string) {
  await title.dblclick();
  const input = page.locator(".react-flow__node-step input");
  await input.fill(value);
  await input.press("Enter");
}

async function titleOf(id: string) {
  const { data } = await db.from("graph_nodes").select("title").eq("id", id).single();
  return (data as { title: string }).title;
}

async function onHand(name: string) {
  const { data } = await db.from("stock_on_hand").select("*").eq("name", name).single();
  return Number((data as { on_hand: number }).on_hand);
}

async function setStock(name: string, value: string) {
  await stock(name).getByRole("button", { name: "Edit" }).click();
  const field = stock(name).getByRole("spinbutton", { name: `${name} amount in` });
  await field.fill(value);
  await field.press("Enter");
  await stock(name).getByRole("button", { name: "Done" }).click();
}

async function openScreen(section: string, screen: string) {
  await page.getByRole("button", { name: section, exact: true }).click();
  await page.getByRole("menu", { name: section }).getByRole("menuitem", { name: screen }).click();
}

test("two devices", async () => {
  const quest = crypto.randomUUID();
  const alpha = crypto.randomUUID();
  const beta = crypto.randomUUID();
  const gamma = crypto.randomUUID();

  await test.step("sign in; device B's steps appear on A", async () => {
    await deviceB.createNode("Sync", null, quest);
    for (const [id, title] of [[alpha, "Alpha"], [beta, "Beta"], [gamma, "Gamma"]]) await deviceB.createNode(title, quest, id);
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(card("Gamma")).toBeVisible({ timeout: 15_000 });
  });

  await test.step("A renames offline, B renames later online: B's title stays", async () => {
    await goOffline();
    await rename(card("Alpha").getByText("Alpha"), "Alpha from A");
    await expect(page.getByText("1 change will sync when you're back online")).toBeVisible();
    await deviceB.updateNode(alpha, { title: "Alpha from B" });
    await goOnline();
    expect(await titleOf(alpha)).toBe("Alpha from B");
    await expect(card("Alpha from B")).toBeVisible();
  });

  await test.step("a change made earlier but sent later loses to the one made later", async () => {
    await rename(card("Alpha from B").getByText("Alpha from B"), "Alpha now");
    await expect.poll(() => titleOf(alpha)).toBe("Alpha now");
    await createApi(db, () => new Date(Date.now() - HOUR_MS)).updateNode(alpha, { title: "Alpha an hour ago" });
    expect(await titleOf(alpha)).toBe("Alpha now");
  });

  await test.step("different fields of one step both keep their change", async () => {
    await goOffline();
    await card("Beta").getByTitle("Mark done").click();
    await deviceB.updateNode(beta, { title: "Beta renamed" });
    await goOnline();
    const { data } = await db.from("graph_nodes").select("title, completed_at").eq("id", beta).single();
    expect(data?.title).toBe("Beta renamed");
    expect(data?.completed_at).toBeTruthy();
  });

  await test.step("an offline edit of a step deleted elsewhere is named and dropped", async () => {
    await goOffline();
    await rename(card("Gamma").getByText("Gamma"), "Gamma edited");
    await deviceB.deleteNode(gamma);
    await page.context().setOffline(false);
    await expect(page.getByText(/Not saved from offline: .*deleted on another device/)).toBeVisible({ timeout: 15_000 });
    const { data } = await db.from("graph_nodes").select("id").eq("id", gamma);
    expect(data).toHaveLength(0);
    await expect(page.locator(".react-flow__node").filter({ hasText: "Gamma" })).toHaveCount(0);
    await page.getByText(/Not saved from offline/).click();
  });

  await test.step("a routine checked on both devices is checked once; the tick made later wins", async () => {
    const routine = crypto.randomUUID();
    await deviceB.createRoutine({ id: routine, title: "Sync routine", cue: "", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], time: null, alarm: "none" });
    const row = page.getByText("Sync routine").locator("xpath=ancestor::*[.//button[@title='Mark done']][1]");
    // The live connection may still be rejoining after the last step's offline spell: Realtime retries
    // after 1, 2, 5 and then every 10 s, and reads everything again once rejoined
    await expect(row).toBeVisible({ timeout: 25_000 });
    await goOffline();
    await row.getByTitle("Mark done").click();
    await deviceB.setRoutineCheck(routine, today(), true);
    await goOnline();
    const { data } = await db.from("routine_checks").select("checked").eq("routine_id", routine).eq("date", today());
    expect(data).toEqual([{ checked: true }]);

    // An untick made an hour ago, sent now, loses to the tick made since; one made now wins
    await createApi(db, () => new Date(Date.now() - HOUR_MS)).setRoutineCheck(routine, today(), false);
    expect((await db.from("routine_checks").select("checked").eq("routine_id", routine).single()).data).toEqual({ checked: true });
    await deviceB.setRoutineCheck(routine, today(), false);
    expect((await db.from("routine_checks").select("checked").eq("routine_id", routine).single()).data).toEqual({ checked: false });
    await expect(row.getByTitle("Mark done")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("level-ups add up, and a replayed one counts once", async () => {
    const before = (await db.from("progress_log").select("id").eq("node_id", quest)).data!.length;
    const replayed = crypto.randomUUID();
    await deviceB.levelUp(quest, replayed);
    await deviceB.levelUp(quest, replayed);
    await deviceB.levelUp(quest, crypto.randomUUID());
    const after = (await db.from("progress_log").select("id").eq("node_id", quest)).data!.length;
    expect(after - before).toBe(2);
  });

  await test.step("stock: equal readings on both devices give that amount, not twice it", async () => {
    const rice = crypto.randomUUID();
    await deviceB.createStockItem({ id: rice, name: "Rice", unit: "kg", target: 2000, readAt: null });
    await openScreen("Kitchen", "Planning");
    await expect(amountLabel("Rice")).toHaveText("0 kg / 2 kg", { timeout: 10_000 });
    await goOffline();
    await setStock("Rice", "4.9");
    await deviceB.setStock(crypto.randomUUID(), rice, 4900);
    await goOnline();
    expect(await onHand("Rice")).toBe(4900);
    await expect(amountLabel("Rice")).toHaveText("4.9 kg / 2 kg");

    await test.step("a reading taken after cooking already includes it; one taken before does not", async () => {
      const recipe = crypto.randomUUID();
      await deviceB.saveRecipe({
        id: recipe,
        title: "Plain rice",
        body: "",
        ingredients: [{ id: crypto.randomUUID(), itemId: rice, name: "Rice", amount: 200, unit: "g" }],
        reminders: [],
      });
      for (const slot of ["lunch", "dinner"] as const) {
        await deviceB.setMeal({ id: crypto.randomUUID(), date: today(), slot, description: "Rice", recipeIds: [recipe], status: "planned" });
      }
      await expect(meal("lunch")).toContainText("Rice", { timeout: 10_000 });

      // Cooked offline first, read on B afterwards: the reading stands
      await goOffline();
      await meal("lunch").getByTitle("Mark done").click();
      await deviceB.setStock(crypto.randomUUID(), rice, 3000);
      await goOnline();
      expect(await onHand("Rice")).toBe(3000);

      // Read on B first, cooked offline afterwards: the reading less the meal
      await deviceB.setStock(crypto.randomUUID(), rice, 3000);
      await goOffline();
      await meal("dinner").getByTitle("Mark done").click();
      await goOnline();
      expect(await onHand("Rice")).toBe(2800);
      await expect(amountLabel("Rice")).toHaveText("2.8 kg / 2 kg");
    });
  });

  expect(pageErrors).toEqual([]);
});
