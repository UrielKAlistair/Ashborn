import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, today as appToday } from "../../src/shared/dates";
import { phoneWindow } from "../phoneWindow";

// One walk through the Kitchen in a fresh profile, signed in as the test user: tracking staples,
// correcting stock by hand, writing a recipe, planning, ticking and unticking meals against stock,
// an untracked ingredient, cancelling, the default week, and the phone's screens.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

let app: ElectronApplication;
let page: Page;
let profile: string;
const pageErrors: string[] = [];

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  // Stock changes, ingredients, reminders and recipe links go with these
  for (const table of ["meals", "default_meals", "recipes", "stock_items"]) {
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
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

// The app's day, which turns over at the day-start hour (the test user's is the default), not at midnight
function dayFromToday(days: number) {
  return addDays(appToday(), days);
}

const today = dayFromToday(0);
const meal = (slot: string, date = today) => page.getByRole("group", { name: `${slot} on ${date}` });
const stock = (name: string) => page.getByRole("group", { name, exact: true });
const amountLabel = (name: string) => stock(name).locator("p.text-right");

async function openScreen(section: string, screen: string) {
  await page.getByRole("button", { name: section, exact: true }).click();
  await page.getByRole("menu", { name: section }).getByRole("menuitem", { name: screen }).click();
}

async function setStock(name: string, value: string) {
  await stock(name).getByRole("button", { name: "Edit" }).click();
  const field = stock(name).getByRole("spinbutton", { name: `${name} amount in` });
  await field.fill(value);
  await field.press("Enter");
  await stock(name).getByRole("button", { name: "Done" }).click();
}

async function onHand(name: string) {
  const { data } = await db.from("stock_on_hand").select("*").eq("name", name).single();
  return Number((data as { on_hand: number }).on_hand);
}

test("kitchen", async () => {
  await test.step("sign in and open the Kitchen from the sidebar's menu", async () => {
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Kitchen", exact: true })).toBeVisible({ timeout: 15_000 });
    await openScreen("Kitchen", "Planning");
    await expect(page.getByRole("heading", { name: "Meal plan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stocks" })).toBeVisible();
  });

  await test.step("tracking staples; a hand correction moves the bar, past its target too", async () => {
    for (const [name, keep] of [["Rice", "2"], ["Butter beans", "1"]]) {
      await page.getByRole("button", { name: "+ Track a staple" }).click();
      await page.getByLabel("Staple").fill(name);
      await page.getByLabel("Amount to keep").fill(keep);
      await page.getByRole("button", { name: "Add" }).click();
      await expect(amountLabel(name)).toHaveText(`0 kg / ${keep} kg`);
    }

    await setStock("Rice", "5");
    await expect(amountLabel("Rice")).toHaveText("5 kg / 2 kg");
    await expect(stock("Rice").getByTitle("More than you usually keep")).toBeVisible();
    await expect.poll(() => onHand("Rice")).toBe(5000);

    await setStock("Butter beans", "0.2");
    await expect(stock("Butter beans").locator(".bg-amber-300\\/85")).toHaveCount(1);
    await setStock("Butter beans", "0.05");
    await expect(stock("Butter beans").locator(".bg-red-400\\/85")).toHaveCount(1);
    await setStock("Butter beans", "1");
  });

  await test.step("a recipe with tracked ingredients and a reminder timed from another", async () => {
    await openScreen("Kitchen", "Cookbook");
    await page.getByRole("button", { name: "+ New recipe" }).click();
    await page.getByLabel("Recipe name").fill("Rice and beans");
    await page.getByLabel("Method").fill("Take 200 grams of rice, wash it twice.\nCook the beans soft.");
    await page.getByRole("button", { name: "+ Ingredient" }).click();
    await page.getByRole("button", { name: "+ Ingredient" }).click();
    const rows = page.getByLabel("Stock item");
    await rows.nth(0).selectOption({ label: "Rice" });
    await page.getByLabel("Rice amount").fill("200");
    await rows.nth(1).selectOption({ label: "Butter beans" });
    await page.getByLabel("Butter beans amount").fill("100");

    await page.getByRole("button", { name: "+ Reminder" }).click();
    await page.getByLabel("Reminder", { exact: true }).last().fill("Soak the beans");
    await page.getByLabel("Soak the beans hours").fill("10");
    await page.getByRole("button", { name: "+ Reminder" }).click();
    await page.getByLabel("Reminder", { exact: true }).last().fill("Drain the beans");
    await page.getByLabel("Drain the beans hours").fill("8");
    await page.getByLabel("Drain the beans before or after").selectOption("after");
    await page.getByLabel("Drain the beans timed from").selectOption({ label: "Soak the beans" });
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { name: "Rice and beans" })).toBeVisible();
    await expect(page.getByText("8 h after Soak the beans")).toBeVisible();
    await expect(page.getByText("45 min before the meal")).toBeVisible();
  });

  await test.step("a planned meal, ticked, takes its recipe's amounts off the stocks", async () => {
    await openScreen("Kitchen", "Planning");
    await meal("lunch").getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("lunch description").fill("Rice with butter beans");
    await page.getByRole("button", { name: "Rice and beans", pressed: false }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(meal("lunch")).toContainText("Rice with butter beans");

    await meal("lunch").getByTitle("Mark done").click();
    await expect(amountLabel("Rice")).toHaveText("4.8 kg / 2 kg");
    await expect(amountLabel("Butter beans")).toHaveText("0.9 kg / 1 kg");
  });

  await test.step("unticking restores exactly what was taken, even after the recipe changed", async () => {
    await meal("lunch").getByRole("button", { name: "Rice and beans" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Rice amount").fill("300");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("300 g")).toBeVisible();

    await openScreen("Kitchen", "Planning");
    await meal("lunch").getByTitle("Mark not done").click();
    await expect(amountLabel("Rice")).toHaveText("5 kg / 2 kg");
    await expect(amountLabel("Butter beans")).toHaveText("1 kg / 1 kg");
  });

  await test.step("an ingredient no longer tracked is reported and skipped; the rest is deducted", async () => {
    await stock("Butter beans").getByRole("button", { name: "Edit" }).click();
    await stock("Butter beans").getByRole("button", { name: "Stop tracking" }).click();
    await stock("Butter beans").getByRole("button", { name: "Stop tracking?" }).click();
    await expect(stock("Butter beans")).toHaveCount(0);

    await meal("lunch").getByTitle("Mark done").click();
    await expect(meal("lunch").getByText("Not in your stocks, so not deducted: Butter beans")).toBeVisible();
    await expect(amountLabel("Rice")).toHaveText("4.7 kg / 2 kg");
  });

  await test.step("cancelling a meal ahead of time, and bringing it back", async () => {
    const tomorrow = dayFromToday(1);
    await meal("dinner", tomorrow).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("dinner description").fill("Dal");
    await page.getByRole("button", { name: "Save" }).click();
    await meal("dinner", tomorrow).getByRole("button", { name: "Cancel" }).click();
    await expect(meal("dinner", tomorrow).getByText("Dal")).toHaveClass(/line-through/);
    await expect.poll(async () => (await db.from("meals").select("status").eq("date", tomorrow).eq("slot", "dinner").single()).data?.status).toBe("cancelled");
    await meal("dinner", tomorrow).getByRole("button", { name: "Restore" }).click();
    await expect(meal("dinner", tomorrow).getByText("Dal")).not.toHaveClass(/line-through/);
  });

  await test.step("the default week fills a day not planned", async () => {
    const later = dayFromToday(2);
    const weekday = new Date(`${later}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
    await page.getByRole("switch", { name: "Default week" }).click();
    await page.getByRole("group", { name: `Default breakfast on ${weekday}` }).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("breakfast description").fill("Oats");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("switch", { name: "Default week" }).click();
    await expect(meal("breakfast", later)).toContainText("Oats");
  });

  await test.step("on a phone-sized window the Kitchen is three screens", async () => {
    await phoneWindow(app, page);
    await openScreen("Kitchen", "Stocks");
    await expect(amountLabel("Rice")).toBeVisible();
    await openScreen("Kitchen", "Meal plan");
    await expect(meal("lunch")).toBeInViewport();
    await openScreen("Kitchen", "Recipes");
    await page.getByRole("button", { name: "Rice and beans" }).click();
    await expect(page.getByRole("heading", { name: "Rice and beans" })).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
