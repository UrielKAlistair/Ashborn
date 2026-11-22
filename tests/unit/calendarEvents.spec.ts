import { expect, test } from "@playwright/test";
import { emptyKitchen } from "../../src/shared/kitchen";
import { calendarEvents, dayEvents } from "../../src/pages/calendar/calendarEvents";
import type { Alarm, Deadline, Snapshot } from "../../src/shared/types";

// What the Calendar shows on a day: dated alarms and events, deadlines, and the repeating events

const alarm = (overrides: Partial<Alarm>): Alarm => ({ id: "a", label: "", kind: "plain", sound: "default", minutes: null, at: null, time: null, weekdays: [], enabled: true, ...overrides });
const deadline = (overrides: Partial<Deadline>): Deadline => ({ id: "d", nodeId: null, title: "Deadline", dueDate: "2026-10-19", alarmTime: null, ...overrides });
const snapshot = (parts: Partial<Snapshot>): Snapshot => ({
  nodes: [],
  edges: [],
  routines: [],
  routineChecks: [],
  deadlines: [],
  alarms: [],
  skippedAlarms: [],
  kitchen: emptyKitchen,
  settings: { timeZone: null },
  ...parts,
});

// 2026-10-19 is a Monday
const titles = (parts: Partial<Snapshot>, date: string) => dayEvents(calendarEvents(snapshot(parts)), date).map((event) => event.title);

test("a repeating event shows on its weekdays, in time order with the day's own; a repeating ring doesn't", () => {
  const lecture = alarm({ id: "lecture", label: "Lecture", kind: "none", minutes: 60, time: "17:00", weekdays: ["Mon", "Wed"] });
  const wake = alarm({ id: "wake", label: "Wake", time: "07:00", weekdays: ["Mon"] });
  const test1 = alarm({ id: "test", label: "Test", kind: "none", minutes: 120, at: new Date("2026-10-19T14:00:00").toISOString() });
  const parts = { alarms: [lecture, wake, test1], deadlines: [deadline({ title: "Rent" })] };
  expect(titles(parts, "2026-10-19")).toEqual(["Rent", "Test", "Lecture"]);
  expect(titles(parts, "2026-10-20")).toEqual([]);
  expect(titles(parts, "2026-10-21")).toEqual(["Lecture"]);
});

test("a repeating event that is switched off stays off the calendar", () => {
  const lecture = alarm({ id: "lecture", label: "Lecture", kind: "none", time: "17:00", weekdays: ["Mon"], enabled: false });
  expect(titles({ alarms: [lecture] }, "2026-10-19")).toEqual([]);
});

test("an event with no label is named an event, one-off or repeating", () => {
  const once = alarm({ id: "once", kind: "none", at: new Date("2026-10-19T14:00:00").toISOString() });
  const weekly = alarm({ id: "weekly", kind: "none", time: "17:00", weekdays: ["Mon"] });
  expect(titles({ alarms: [once, weekly] }, "2026-10-19")).toEqual(["Event", "Event"]);
});
