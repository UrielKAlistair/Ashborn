import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { showTime, toISODate } from "../../src/shared/dates";
import { weekStart } from "../../src/pages/calendar/calendarEvents";

// The Alarms page: today's rings, each with how long until it rings, skipped for today alone by its
// switch or moved that day alone by a tap; tomorrow's rings one arrow away; the repeating alarms,
// turned off, and opened to edit or delete; a quick alarm set from the pop-up and opened from Today
// to relabel. The Calendar: a one-time alarm edited there, and a deadline added. The alarm rings a few minutes from
// now, so this fails if run in the last minutes before midnight.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("alarms", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["events", "alarms", "alarm_skips", "routines", "deadlines"]) {
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
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.getByRole("menuitem", { name: "Alarms", exact: true }).click({ timeout: 20_000 });
    // A row shows the time and AM/PM in separate spans
    await expect(ring("Stretch")).toContainText(showTime(time).replace(" ", ""));
    await expect(ring("Stretch")).toContainText(/in \d min/);
    await ring("Stretch").getByRole("switch").click();
    await expect.poll(skipOf).toBe(true);
    await expect(ring("Stretch").getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect((await alarmRow())?.enabled).toBe(true);
    await ring("Stretch").getByRole("switch").click();
    await expect.poll(skipOf).toBe(false);
  });

  await test.step("a tap on today's ring moves it, today only, and it then shows once, at its new time", async () => {
    const later = new Date(soon.getTime() + 2 * 60_000);
    const laterTime = `${String(later.getHours()).padStart(2, "0")}:${String(later.getMinutes()).padStart(2, "0")}`;
    const moved = `Stretch (moved from ${showTime(time)})`;
    const movedRows = async () => (await db.from("alarms").select("at").eq("label", moved)).data ?? [];
    await ring("Stretch").getByRole("button", { name: "Edit Stretch" }).click();
    const dialog = page.getByRole("dialog", { name: "Move this ring" });
    await dialog.getByLabel("Ring at").fill(laterTime);
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect.poll(skipOf).toBe(true);
    await expect.poll(async () => (await movedRows()).map((row) => new Date(row.at).getMinutes())).toEqual([later.getMinutes()]);
    await expect(ring("Stretch")).toHaveCount(1);
    await expect(ring("Stretch")).toContainText(showTime(laterTime).replace(" ", ""));
    await expect(ring("Stretch")).toContainText(`Moved from ${showTime(time)}`);
    // The repeating alarm itself is unchanged
    expect((await db.from("alarms").select("time").eq("id", id).single()).data?.time.slice(0, 5)).toBe(time);

    // Undone the way the agent's restore_ring does it, for the next step
    await db.from("alarms").delete().eq("label", moved);
    await db.from("alarm_skips").delete().not("user_id", "is", null);
    await expect(ring("Stretch")).toContainText(showTime(time).replace(" ", ""));
  });

  await test.step("tomorrow lists the day's rings, and the arrow back returns to today", async () => {
    await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tomorrow" })).toBeVisible();
    await expect(ring("Stretch")).toContainText(/in 2\dh/);
    await expect(ring("Rang this morning")).toHaveCount(0);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(ring("Rang this morning")).toBeVisible();
  });

  await test.step("repeating: turned off, edited, deleted; a one-off is not listed", async () => {
    await page.getByRole("button", { name: "Repeating ›" }).click();
    await expect(ring("Stretch")).toBeVisible();
    await expect(ring("Dentist")).toHaveCount(0);
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

  await test.step("calendar: a one-off relabelled keeps its moment; one deleted elsewhere closes", async () => {
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.getByRole("menuitem", { name: "Calendar", exact: true }).click();
    await expect(page.getByText("Rang this morning")).toBeVisible(); // still in the snapshot, on today
    // Today's column marks now, and greys the alarm that has rung
    await expect(page.getByRole("separator", { name: "Now" })).toBeVisible();
    await expect(ring("Rang this morning")).toHaveClass(/opacity-50/);
    // A tap on today's name opens the whole day, as the Alarms screen shows it
    await page.getByRole("button", { name: "See today" }).click();
    const day = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Day after ›" }) });
    await expect(day.getByRole("group", { name: "Rang this morning", exact: true })).toBeVisible();
    await day.getByRole("button", { name: "Day after ›" }).click();
    await expect(day.getByRole("group", { name: "Rang this morning", exact: true })).toHaveCount(0);
    await day.getByRole("button", { name: "Close" }).click();
    // The Calendar shows a week, Monday to Sunday: from Friday on, three days ahead is the next one
    if (weekStart(toISODate(new Date(laterAt))) !== weekStart(toISODate(new Date()))) await page.getByRole("button", { name: "Next week" }).click();
    await ring("Dentist").getByRole("button", { name: "Open Dentist" }).click();
    const dialog = page.getByRole("dialog", { name: "Alarm" });
    await dialog.getByPlaceholder("What for (optional)").fill("Dentist, bring the form");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await db.from("alarms").select("label").eq("id", later).single()).data?.label).toBe("Dentist, bring the form");
    expect(Date.parse((await db.from("alarms").select("at").eq("id", later).single()).data!.at)).toBe(Date.parse(laterAt));

    await ring("Dentist, bring the form").getByRole("button", { name: "Open Dentist, bring the form" }).click();
    await dialog.getByLabel("Time").fill("");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await db.from("alarms").delete().eq("id", later);
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  });

  await test.step("calendar: a deadline added from + and changed", async () => {
    await page.getByRole("button", { name: "Add to the calendar" }).click();
    const dialog = page.getByRole("dialog", { name: /^New on / });
    await dialog.getByRole("tab", { name: "Deadline" }).click();
    await dialog.getByPlaceholder("What is due").fill("Hand in the essay");
    await dialog.getByRole("button", { name: "Add" }).click();
    await expect.poll(async () => (await db.from("deadlines").select("title").eq("title", "Hand in the essay")).data?.length).toBe(1);
    await expect(ring("Hand in the essay")).toBeVisible();

    // Opened again, its title changes
    await page.getByRole("button", { name: "Open Hand in the essay", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Deadline" });
    await edit.getByPlaceholder("What is due").fill("Hand in the essay draft");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await db.from("deadlines").select("title").eq("title", "Hand in the essay draft")).data?.length).toBe(1);
  });

  await test.step("the + pop-up sets a quick alarm, which rings today and opens from there", async () => {
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.getByRole("menuitem", { name: "Alarms", exact: true }).click();
    const count = async () => (await db.from("alarms").select("id")).data?.length;
    const before = await count();
    await page.getByRole("button", { name: "New on this day" }).click();
    const pop = page.getByRole("dialog", { name: /^New on/ });
    await pop.getByRole("tab", { name: "Alarm" }).click();
    await pop.getByRole("button", { name: "In 10 min" }).click();
    await expect.poll(count).toBe(before! + 1);
    // Today lists the rings before midnight: in the day's last minutes the alarm is on the Calendar only
    if (new Date(Date.now() + 10 * 60_000).getDate() !== new Date().getDate()) {
      test.info().annotations.push({ type: "skip", description: "Opening from Today not checked: the alarm rings after midnight" });
      return;
    }
    await expect(ring("Alarm")).toBeVisible();

    await ring("Alarm").getByRole("button", { name: "Edit Alarm" }).click();
    const dialog = page.getByRole("dialog", { name: "Alarm" });
    await dialog.getByPlaceholder("What for (optional)").fill("Tea");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await db.from("alarms").select("label").eq("label", "Tea")).data?.length).toBe(1);
    await expect(ring("Tea")).toBeVisible();
  });

  await test.step("an event from + is on the day's schedule, lit while on with now drawn across it, never rings, and opens on its details", async () => {
    const from = new Date(Date.now() - 30 * 60_000);
    const to = new Date(Date.now() + 60 * 60_000);
    if (toISODate(from) !== toISODate(to)) {
      test.info().annotations.push({ type: "skip", description: "Event not checked: it would cross midnight" });
      return;
    }
    const clock = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    await page.getByRole("button", { name: "New on this day" }).click();
    const pop = page.getByRole("dialog", { name: /^New on/ });
    await pop.getByLabel("Starts", { exact: true }).fill(clock(from));
    await pop.getByLabel("Ends (optional)", { exact: true }).fill(clock(to));
    await pop.getByPlaceholder("What is on").fill("Aptitude test");
    await pop.getByLabel("Details").fill("Hall B, for Acme");
    await pop.getByRole("button", { name: "Add" }).click();
    await expect.poll(async () => (await db.from("events").select("minutes, rings, details").eq("title", "Aptitude test").maybeSingle()).data).toEqual({ minutes: 90, rings: null, details: "Hall B, for Acme" });
    expect((await db.from("alarms").select("id").eq("label", "Aptitude test")).data).toEqual([]);
    const row = ring("Aptitude test");
    await expect(row.getByText("on now", { exact: true })).toBeVisible();
    await expect(row.getByText(`Event · ${showTime(clock(from))} – ${showTime(clock(to))} · 1h 30m`, { exact: true })).toBeVisible();
    await expect(row.getByRole("switch")).toHaveCount(0);
    // A third of the way through, the line for now crosses the event's row a third of the way down
    const line = await page.getByRole("separator", { name: "Now" }).boundingBox();
    const box = await row.boundingBox();
    expect(Math.abs(line!.y + line!.height / 2 - (box!.y + box!.height / 3))).toBeLessThan(4);
    await row.getByRole("button", { name: /Aptitude test/ }).first().click();
    const shown = page.getByRole("dialog", { name: "Event" });
    await expect(shown.getByText("Hall B, for Acme")).toBeVisible();
    await expect(shown.getByText("Doesn't ring")).toBeVisible();
    await shown.getByRole("button", { name: "Close" }).click();
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
