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
  // A one-off three days ahead, as the connector sets one
  const later = crypto.randomUUID();
  const laterAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  // A one-off that rang an hour ago: the snapshot keeps it a day for its snooze, but it is no longer set
  const { error: seedError } = await db.from("alarms").insert([
    { id, label: "Stretch", kind: "plain", time, weekdays: everyDay, at: null },
    { id: later, label: "Dentist", kind: "plain", time: null, weekdays: [], at: laterAt },
    { id: crypto.randomUUID(), label: "Rang this morning", kind: "plain", time: null, weekdays: [], at: new Date(Date.now() - 60 * 60_000).toISOString() },
  ]);
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
    await expect(ring("Stretch")).toBeVisible();
    await expect(page.getByText("Rang this morning")).toHaveCount(0);
    // Relabelled, a one-off keeps its moment
    await ring("Dentist").getByRole("button", { name: "Edit Dentist" }).click();
    await page.getByRole("dialog", { name: "Edit alarm" }).getByPlaceholder("Label (optional)").fill("Dentist, bring the form");
    await page.getByRole("dialog", { name: "Edit alarm" }).getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await db.from("alarms").select("label").eq("id", later).single()).data?.label).toBe("Dentist, bring the form");
    expect(Date.parse((await db.from("alarms").select("at").eq("id", later).single()).data!.at)).toBe(Date.parse(laterAt));
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

  await test.step("an open alarm needs a time to save, and closes when it is deleted elsewhere", async () => {
    await ring("Dentist, bring the form").getByRole("button", { name: "Edit Dentist, bring the form" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit alarm" });
    await dialog.getByLabel("Time").fill("");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await db.from("alarms").delete().eq("id", later);
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  });

  await test.step("the + pop-up sets a quick alarm, which rings today", async () => {
    await page.getByRole("button", { name: "‹ Today" }).click();
    const count = async () => (await db.from("alarms").select("id")).data?.length;
    const before = await count();
    await page.getByRole("button", { name: "New alarm" }).click();
    await page.getByRole("dialog", { name: "New alarm" }).getByRole("button", { name: "In 10 min" }).click();
    await expect.poll(count).toBe(before! + 1);
    await expect(ring("Alarm")).toBeVisible();
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
