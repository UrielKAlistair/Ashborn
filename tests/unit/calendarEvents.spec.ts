import { expect, test } from "@playwright/test";
import { emptyKitchen } from "../../src/shared/kitchen";
import { calendarEvents, dayEvents } from "../../src/pages/calendar/calendarEvents";
import type { Alarm, Deadline, ScheduleEvent, Snapshot } from "../../src/shared/types";

// What the Calendar shows on a day: dated alarms and events, deadlines, and the repeating events

const alarm = (overrides: Partial<Alarm>): Alarm => ({ id: "a", label: "", kind: "plain", sound: "default", at: null, time: null, weekdays: [], enabled: true, eventId: null, ...overrides });
const event = (overrides: Partial<ScheduleEvent>): ScheduleEvent => ({ id: "e", title: "", details: "", at: null, time: null, weekdays: [], minutes: null, rings: null, ...overrides });
const deadline = (overrides: Partial<Deadline>): Deadline => ({ id: "d", nodeId: null, title: "Deadline", dueDate: "2026-10-19", alarmTime: null, ...overrides });
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

// 2026-10-19 is a Monday
const titles = (parts: Partial<Snapshot>, date: string) => dayEvents(calendarEvents(snapshot(parts)), date).map((event) => event.title);

test("a repeating event shows on its weekdays, in time order with the day's own; a repeating ring doesn't", () => {
  const lecture = event({ id: "lecture", title: "Lecture", minutes: 60, time: "17:00", weekdays: ["Mon", "Wed"] });
  const wake = alarm({ id: "wake", label: "Wake", time: "07:00", weekdays: ["Mon"] });
  const test1 = event({ id: "test", title: "Test", minutes: 120, at: new Date("2026-10-19T14:00:00").toISOString() });
  const parts = { alarms: [wake], events: [lecture, test1], deadlines: [deadline({ title: "Rent" })] };
  expect(titles(parts, "2026-10-19")).toEqual(["Rent", "Test", "Lecture"]);
  expect(titles(parts, "2026-10-20")).toEqual([]);
  expect(titles(parts, "2026-10-21")).toEqual(["Lecture"]);
});

test("an event that rings at its start shows once, as the event, not again as its alarm", () => {
  const soak = event({ id: "soak", title: "Soak", at: new Date("2026-10-19T14:00:00").toISOString(), rings: "plain" });
  const start = alarm({ id: "start", label: "Soak", at: soak.at, eventId: "soak" });
  expect(dayEvents(calendarEvents(snapshot({ alarms: [start], events: [soak] })), "2026-10-19").map((shown) => `${shown.kind} ${shown.title}`)).toEqual(["event Soak"]);
});

test("an event with no title is named an event, one-off or repeating", () => {
  const once = event({ id: "once", at: new Date("2026-10-19T14:00:00").toISOString() });
  const weekly = event({ id: "weekly", time: "17:00", weekdays: ["Mon"] });
  expect(titles({ events: [once, weekly] }, "2026-10-19")).toEqual(["Event", "Event"]);
});
