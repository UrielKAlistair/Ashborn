import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// Split into steps: a list typed in the panel, or pasted into the add-step row, becomes steps
// inside the box, chained in order unless that is unticked.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("split into steps", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  await db.from("graph_nodes").delete().not("id", "is", null);
  const quest = crypto.randomUUID();
  const { error: insertError } = await db.from("graph_nodes").insert({ id: quest, title: "Talk", parent_id: null });
  if (insertError) throw insertError;

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const box = page.locator(".react-flow__node-quest").filter({ hasText: "Talk" });
  const steps = page.locator(".react-flow__node-step");
  const stepRows = async () => (await db.from("graph_nodes").select("id, title").eq("parent_id", quest)).data ?? [];

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(box).toBeVisible({ timeout: 15_000 });

  await test.step("a typed list becomes a chain of steps", async () => {
    await box.getByTitle("Add a step inside").click();
    await page.getByTitle("Split into steps: type or paste a list").click();
    await page.getByLabel("Steps, one per line").fill("- Outline the talk\n- Draft slides\n\n- Rehearse once");
    await expect(page.getByText("3 steps")).toBeVisible();
    await page.getByRole("button", { name: "Add steps" }).click();
    await expect(steps).toHaveCount(3);
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    await expect.poll(async () => (await stepRows()).map((row) => row.title).sort()).toEqual(["Draft slides", "Outline the talk", "Rehearse once"]);
  });

  await test.step("unticked, the steps come unlinked", async () => {
    await box.getByTitle("Add a step inside").click();
    await page.getByTitle("Split into steps: type or paste a list").click();
    await page.getByLabel("Steps, one per line").fill("Book a room\nPrint handouts");
    await page.getByLabel(/In this order/).uncheck();
    await page.getByRole("button", { name: "Add steps" }).click();
    await expect(steps).toHaveCount(5);
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  });

  await test.step("a pasted list opens the panel prefilled; a pasted line stays in the field", async () => {
    const paste = (text: string) =>
      page.getByPlaceholder("Step name, Enter to add").evaluate((input, pasted) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text", pasted);
        return input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
      }, text);

    await box.getByTitle("Add a step inside").click();
    expect(await paste("Just one line\n")).toBe(true); // not cancelled: the browser fills the field
    await expect(page.getByLabel("Steps, one per line")).toHaveCount(0);

    await page.getByPlaceholder("Step name, Enter to add").fill("Typed first ");
    expect(await paste("pasted\n2. Second\n3. Third")).toBe(false);
    await expect(page.getByLabel("Steps, one per line")).toHaveValue("Typed first pasted\n2. Second\n3. Third");
    await expect(page.getByText("3 steps")).toBeVisible();
    await page.getByRole("button", { name: "Add steps" }).click();
    await expect(steps).toHaveCount(8);
    await expect(page.getByLabel("Steps, one per line")).toHaveCount(0);
    await expect.poll(async () => (await stepRows()).map((row) => row.title)).toEqual(expect.arrayContaining(["Typed first pasted", "Second", "Third"]));
  });

  await test.step("on the phone, the sheet opens the panel whole on the screen", async () => {
    await phoneWindow(app, page);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("menu", { name: "Home" }).getByRole("menuitem", { name: "Graph" }).click();
    await box.getByRole("button", { name: "Actions" }).first().click();
    await page.getByRole("button", { name: "Split into steps" }).click();
    await page.getByLabel("Steps, one per line").fill("On the phone one\nOn the phone two");
    const add = await page.getByRole("button", { name: "Add steps" }).boundingBox();
    expect(add!.x + add!.width).toBeLessThanOrEqual(400);
    expect(add!.y + add!.height).toBeLessThanOrEqual(860);
    await page.getByRole("button", { name: "Add steps" }).click();
    await expect(page.getByLabel("Steps, one per line")).toHaveCount(0);
    await expect.poll(async () => (await stepRows()).map((row) => row.title)).toEqual(expect.arrayContaining(["On the phone one", "On the phone two"]));
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
