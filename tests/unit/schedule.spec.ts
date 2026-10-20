import { expect, test } from "@playwright/test";
import { emptyKitchen } from "../../src/shared/kitchen";
import { upcomingAlarms } from "../../src/shared/schedule";
import type { Alarm, Deadline, Routine, Snapshot } from "../../src/shared/types";

// Which alarms the phone should schedule, from routines and deadlines

const routine = (overrides: Partial<Routine>): Routine => ({ id: "r", title: "Routine", cue: "", weekdays: [], time: null, alarm: "none", ...overrides });
const deadline = (overrides: Partial<Deadline>): Deadline => ({ id: "d", title: "Deadline", dueDate: "2026-10-20", alarmTime: null, ...overrides });
const alarm = (overrides: Partial<Alarm>): Alarm => ({ id: "a", label: "", kind: "plain", at: null, time: null, weekdays: [], enabled: true, ...overrides });
const snapshot = (parts: Partial<Snapshot>): Snapshot => ({
  nodes: [],
  edges: [],
  routines: [],
  routineChecks: [],
  deadlines: [],
  alarms: [],
  progressToday: { date: "2026-10-19", count: 0 },
  kitchen: emptyKitchen,
  ...parts,
});

const monday6am = new Date("2026-10-19T06:00:00"); // 2026-10-19 is a Monday
const times = (alarms: ReturnType<typeof upcomingAlarms>) => alarms.map((alarm) => `${alarm.key} ${alarm.at.toString().slice(0, 21)}`);

test("routines ring on their weekdays at their time, soonest first", () => {
  const wake = routine({ id: "wake", weekdays: ["Mon", "Wed"], time: "07:00", alarm: "situps" });
  const prep = routine({ id: "prep", weekdays: ["Mon"], time: "06:30", alarm: "plain" });
  expect(times(upcomingAlarms(snapshot({ routines: [wake, prep] }), monday6am, 3))).toEqual([
    "routine:prep@2026-10-19 Mon Oct 19 2026 06:30",
    "routine:wake@2026-10-19 Mon Oct 19 2026 07:00",
    "routine:wake@2026-10-21 Wed Oct 21 2026 07:00",
  ]);
});

test("no alarm, no time, ticked days and past times do not ring", () => {
  const routines = [
    routine({ id: "silent", weekdays: ["Mon"], time: "07:00", alarm: "none" }),
    routine({ id: "untimed", weekdays: ["Mon"] }),
    routine({ id: "ticked", weekdays: ["Mon", "Tue"], time: "07:00", alarm: "plain" }),
    routine({ id: "past", weekdays: ["Mon"], time: "05:00", alarm: "plain" }),
  ];
  const routineChecks = [{ routineId: "ticked", date: "2026-10-19" }];
  expect(times(upcomingAlarms(snapshot({ routines, routineChecks }), monday6am, 2))).toEqual(["routine:ticked@2026-10-20 Tue Oct 20 2026 07:00"]);
});

test("deadlines ring on their due day when they have an alarm time inside the window", () => {
  const deadlines = [
    deadline({ id: "soon", dueDate: "2026-10-20", alarmTime: "09:00" }),
    deadline({ id: "later", dueDate: "2026-10-30", alarmTime: "09:00" }),
    deadline({ id: "quiet", dueDate: "2026-10-20" }),
  ];
  const alarms = upcomingAlarms(snapshot({ deadlines }), monday6am, 7);
  expect(times(alarms)).toEqual(["deadline:soon Tue Oct 20 2026 09:00"]);
  expect(alarms[0]).toMatchObject({ title: "Due today: Deadline", kind: "plain" });
});

test("standalone alarms: recurring ones on their days, one-offs once, switched-off ones never", () => {
  const alarms = [
    alarm({ id: "wake", label: "Wake up", kind: "situps", time: "06:00", weekdays: ["Tue", "Wed"] }),
    alarm({ id: "nap", at: new Date("2026-10-19T15:30:00").toISOString() }),
    alarm({ id: "off", time: "07:00", weekdays: ["Tue"], enabled: false }),
    alarm({ id: "far", at: new Date("2026-11-30T09:00:00").toISOString() }),
  ];
  const found = upcomingAlarms(snapshot({ alarms }), monday6am, 3);
  expect(times(found)).toEqual([
    "alarm:nap Mon Oct 19 2026 15:30",
    "alarm:wake@2026-10-20 Tue Oct 20 2026 06:00",
    "alarm:wake@2026-10-21 Wed Oct 21 2026 06:00",
  ]);
  expect(found[0].title).toBe("Alarm"); // unlabelled
  expect(found[1]).toMatchObject({ title: "Wake up", kind: "situps" });
});

test("meal reminders join the schedule as plain alarms; those already past are dropped", () => {
  const recipe = { id: "r", title: "Dal", body: "", ingredients: [], reminders: [{ id: "prep", label: "Start prep", offsetMinutes: -45, anchorId: null }] };
  const meals = [
    { id: "b", date: "2026-10-19", slot: "breakfast" as const, description: "dal", status: "planned" as const, recipeIds: ["r"] },
    { id: "l", date: "2026-10-19", slot: "lunch" as const, description: "dal", status: "planned" as const, recipeIds: ["r"] },
  ];
  const kitchen = { ...emptyKitchen, recipes: [recipe], meals };
  // At 08:00 the breakfast reminder (07:15) is past; lunch's (12:15) is still to ring
  expect(times(upcomingAlarms(snapshot({ kitchen }), new Date("2026-10-19T08:00:00"), 1))).toEqual(["meal:2026-10-19:lunch:prep Mon Oct 19 2026 12:15"]);
  expect(upcomingAlarms(snapshot({ kitchen }), new Date("2026-10-19T08:00:00"), 1)[0]).toMatchObject({ kind: "plain", title: "Start prep (lunch: Dal)" });
});
