import { expect, test } from "@playwright/test";
import { emptyKitchen } from "../../src/shared/kitchen";
import { eventsOn, nowPlace, upcomingAlarms } from "../../src/shared/schedule";
import type { Alarm, Deadline, Routine, Snapshot, ScheduleEvent } from "../../src/shared/types";

// Which alarms the phone should schedule, from routines and deadlines

const routine = (overrides: Partial<Routine>): Routine => ({ id: "r", title: "Routine", cue: "", weekdays: [], time: null, alarm: "none", ...overrides });
const deadline = (overrides: Partial<Deadline>): Deadline => ({ id: "d", nodeId: null, title: "Deadline", dueDate: "2026-10-20", alarmTime: null, ...overrides });
const alarm = (overrides: Partial<Alarm>): Alarm => ({ id: "a", label: "", kind: "plain", sound: "default", at: null, time: null, weekdays: [], enabled: true, eventId: null, ...overrides });
const event = (overrides: Partial<ScheduleEvent>): ScheduleEvent => ({ id: "e", title: "", details: "", at: null, time: null, weekdays: [], minutes: null, rings: null, ...overrides });
const snapshot = (parts: Partial<Snapshot>): Snapshot => ({
  nodes: [],
  edges: [],
  routines: [],
  routineChecks: [],
  deadlines: [],
  alarms: [],
  events: [],
  skippedAlarms: [],
  kitchen: emptyKitchen,
  settings: { timeZone: null },
  ...parts,
});

const monday6am = new Date("2026-10-19T06:00:00"); // 2026-10-19 is a Monday
const times = (alarms: ReturnType<typeof upcomingAlarms>) => alarms.map((alarm) => `${alarm.key} ${alarm.at.toString().slice(0, 21)}`);

test("a ring skipped does not ring, and only that one", () => {
  const wake = routine({ id: "wake", weekdays: ["Mon", "Tue"], time: "07:00", alarm: "plain" });
  const walk = alarm({ id: "walk", time: "08:00", weekdays: ["Mon"] });
  const skippedAlarms = [{ key: "routine:wake@2026-10-19", date: "2026-10-19" }, { key: "alarm:walk@2026-10-19", date: "2026-10-19" }];
  expect(times(upcomingAlarms(snapshot({ routines: [wake], alarms: [walk], skippedAlarms }), monday6am, 2))).toEqual(["routine:wake@2026-10-20 Tue Oct 20 2026 07:00"]);
});

test("a skip is of one ring: a deadline moved to another day, or a one-off moved, rings again", () => {
  const skippedAlarms = [{ key: "deadline:soon@2026-10-20", date: "2026-10-20" }, { key: `alarm:nap@${new Date("2026-10-19T15:30:00").getTime()}`, date: "2026-10-19" }];
  const deadlines = [deadline({ id: "soon", dueDate: "2026-10-21", alarmTime: "09:00" })];
  const alarms = [alarm({ id: "nap", at: new Date("2026-10-19T16:00:00").toISOString() })];
  expect(times(upcomingAlarms(snapshot({ deadlines, alarms, skippedAlarms }), monday6am, 3)).map((ring) => ring.split(" ")[0])).toEqual([
    `alarm:nap@${new Date("2026-10-19T16:00:00").getTime()}`,
    "deadline:soon@2026-10-21",
  ]);
});

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

test("a routine timed after midnight rings on its own calendar day, and only that day's tick silences it", () => {
  const late = routine({ id: "late", weekdays: ["Tue"], time: "02:00", alarm: "plain" });
  const mondayNight = new Date("2026-10-20T01:30:00");
  expect(times(upcomingAlarms(snapshot({ routines: [late] }), mondayNight, 1))).toEqual(["routine:late@2026-10-20 Tue Oct 20 2026 02:00"]);
  expect(upcomingAlarms(snapshot({ routines: [late], routineChecks: [{ routineId: "late", date: "2026-10-19" }] }), mondayNight, 1)).toHaveLength(1);
  expect(upcomingAlarms(snapshot({ routines: [late], routineChecks: [{ routineId: "late", date: "2026-10-20" }] }), mondayNight, 1)).toEqual([]);
});

test("deadlines ring on their due day when they have an alarm time inside the window", () => {
  const deadlines = [
    deadline({ id: "soon", dueDate: "2026-10-20", alarmTime: "09:00" }),
    deadline({ id: "later", dueDate: "2026-10-30", alarmTime: "09:00" }),
    deadline({ id: "quiet", dueDate: "2026-10-20" }),
  ];
  const alarms = upcomingAlarms(snapshot({ deadlines }), monday6am, 7);
  expect(times(alarms)).toEqual(["deadline:soon@2026-10-20 Tue Oct 20 2026 09:00"]);
  expect(alarms[0]).toMatchObject({ title: "Due today: Deadline", kind: "plain" });
});

test("a deadline's alarm after midnight rings on its due date", () => {
  const deadlines = [deadline({ id: "night", dueDate: "2026-10-20", alarmTime: "03:00" })];
  expect(times(upcomingAlarms(snapshot({ deadlines }), new Date("2026-10-20T01:00:00"), 1))).toEqual(["deadline:night@2026-10-20 Tue Oct 20 2026 03:00"]);
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
    `alarm:nap@${new Date("2026-10-19T15:30:00").getTime()} Mon Oct 19 2026 15:30`,
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

test("an event is on its day's schedule, repeating on its weekdays, a one-off on its date; it never rings itself", () => {
  const exam = event({ id: "exam", title: "Exam", minutes: 120, at: new Date("2026-10-19T11:00:00").toISOString() });
  const lecture = event({ id: "lecture", minutes: 60, time: "09:00", weekdays: ["Mon", "Wed"], rings: "plain" });
  const all = snapshot({ events: [exam, lecture] });
  expect(upcomingAlarms(all, monday6am, 3)).toEqual([]);
  expect(eventsOn(all, "2026-10-19").map((shown) => `${shown.title} ${shown.at.toString().slice(16, 21)} ${shown.minutes}`)).toEqual(["Event 09:00 60", "Exam 11:00 120"]);
  expect(eventsOn(all, "2026-10-20")).toEqual([]);
});

test("the line for now sits below every row that has started, and across an event still on", () => {
  const at = (clock: string) => new Date(`2026-10-19T${clock}:00`);
  const rows = [{ at: at("09:00") }, { at: at("10:00"), minutes: 120 }, { at: at("11:00") }, { at: at("13:00") }];
  expect(nowPlace(rows, at("08:00"))).toEqual({ row: 0, inside: null });
  expect(nowPlace(rows, at("10:30"))).toEqual({ row: 1, inside: 0.25 });
  // An alarm at 11 inside the 10 to 12 event: once it has rung the line is below it
  expect(nowPlace(rows, at("11:30"))).toEqual({ row: 3, inside: null });
  expect(nowPlace(rows, at("12:30"))).toEqual({ row: 3, inside: null });
  expect(nowPlace(rows, at("14:00"))).toEqual({ row: 4, inside: null });
  expect(nowPlace([{ at: at("10:00"), minutes: 60 }], at("10:00"))).toEqual({ row: 0, inside: 0 });
});
