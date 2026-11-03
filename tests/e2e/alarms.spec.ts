import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toISODate } from "../../src/shared/dates";

// The Alarms page: today's rings, each skipped for today alone by its switch; all alarms, turned
// off, and opened to edit or delete; a quick alarm set from the pop-up. The alarm rings a few minutes from
// now, so this fails if run in the last minutes before midnight.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("alarms", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["alarms", "alarm_skips", "routines", "deadlines"]) {
    const { error: wipeError } = await db.from(table).delete().not("user_id", "is", null);
    if (wipeError) throw wipeError;
  }
  const soon = new Date(Date.now() + 5 * 60_000);
  const time = `${String(soon.getHours()).padStart(2, "0")}:${String(soon.getMinutes()).padStart(2, "0")}`;
  const id = crypto.randomUUID();
  const everyDay = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const { error: seedError } = await db.from("alarms").insert({ id, label: "Stretch", kind: "plain", time, weekdays: everyDay });
  if (seedError) throw seedError;
  const skipOf = async () => (await db.from("alarm_skips").select("skipped").eq("key", `alarm:${id}@${toISODate(soon)}`).maybeSingle()).data?.skipped;
  const alarmRow = async () => (await db.from("alarms").select("label, enabled").eq("id", id).maybeSingle()).data;

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const ring = (name: string) => page.getByRole("group", { name, exact: true });

  await test.step("today lists the ring; its switch skips it for today only", async () => {
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Alarms", exact: true }).click({ timeout: 20_000 });
    await expect(ring("Stretch")).toContainText(time);
    await ring("Stretch").getByRole("switch").click();
    await expect.poll(skipOf).toBe(true);
    await expect(ring("Stretch").getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect((await alarmRow())?.enabled).toBe(true);
    await ring("Stretch").getByRole("switch").click();
    await expect.poll(skipOf).toBe(false);
  });

  await test.step("all alarms: turned off, edited, deleted", async () => {
    await page.getByRole("button", { name: "All alarms ›" }).click();
    await ring("Stretch").getByRole("switch").click();
    await expect.poll(async () => (await alarmRow())?.enabled).toBe(false);
    await ring("Stretch").getByRole("button", { name: "Edit Stretch" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit alarm" });
    await dialog.getByPlaceholder("Label (optional)").fill("Stretch well");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await alarmRow())?.label).toBe("Stretch well");
    await expect(dialog).toHaveCount(0);
    await ring("Stretch well").getByRole("button", { name: "Edit Stretch well" }).click();
    await page.getByRole("dialog", { name: "Edit alarm" }).getByRole("button", { name: "Delete this alarm" }).click();
    await expect.poll(alarmRow).toBeNull();
  });

  await test.step("the + pop-up sets a quick alarm, which rings today", async () => {
    await page.getByRole("button", { name: "‹ Today" }).click();
    await page.getByRole("button", { name: "New alarm" }).click();
    await page.getByRole("dialog", { name: "New alarm" }).getByRole("button", { name: "In 10 min" }).click();
    await expect.poll(async () => (await db.from("alarms").select("id")).data?.length).toBe(1);
    await expect(ring("Alarm")).toBeVisible();
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
