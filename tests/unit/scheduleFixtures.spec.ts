import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { toISODate } from "../../src/shared/dates";
import { emptyKitchen } from "../../src/shared/kitchen";
import { upcomingAlarms } from "../../src/shared/schedule";
import type { Alarm, Deadline, Recipe, RecipeReminder, Routine, Snapshot } from "../../src/shared/types";

// Writes the cases the phone's Java copy of the schedule is checked against (ScheduleTest.java,
// run with `npm run android:test`): each case is a snapshot, a moment and a number of days, with
// the alarms upcomingAlarms gives for them. Times are local, in the time zone recorded in the
// file, which the Java test adopts.

const FIXTURES = "android/app/src/test/resources/schedule-fixtures.json";

const routine = (overrides: Partial<Routine>): Routine => ({ id: "r", title: "Routine", cue: "", weekdays: [], time: null, alarm: "none", ...overrides });
const deadline = (overrides: Partial<Deadline>): Deadline => ({ id: "d", nodeId: null, title: "Deadline", dueDate: "2026-10-20", alarmTime: null, ...overrides });
const alarm = (overrides: Partial<Alarm>): Alarm => ({ id: "a", label: "", kind: "plain", at: null, time: null, weekdays: [], enabled: true, ...overrides });
const reminder = (id: string, offsetMinutes: number, anchorId: string | null = null): RecipeReminder => ({ id, label: id, offsetMinutes, anchorId });
const recipe = (id: string, title: string, reminders: RecipeReminder[]): Recipe => ({ id, title, body: "", ingredients: [], reminders });
const snapshot = (parts: Partial<Snapshot>): Snapshot => ({
  nodes: [],
  edges: [],
  routines: [],
  routineChecks: [],
  deadlines: [],
  alarms: [],
  skippedAlarms: [],
  progressToday: { date: "2026-10-19", count: 0 },
  kitchen: emptyKitchen,
  settings: { dayStartHour: 4, timeZone: null },
  ...parts,
});

// 2026-10-19 is a Monday
const cases: { name: string; snapshot: Snapshot; from: string; days: number }[] = [
  {
    name: "routines: weekdays, no alarm, untimed, ticked, past, and one before the day-start hour",
    snapshot: snapshot({
      routines: [
        routine({ id: "wake", title: "Wake", weekdays: ["Mon", "Wed"], time: "07:00", alarm: "situps" }),
        routine({ id: "prep", title: "Prep", weekdays: ["Mon"], time: "06:30", alarm: "plain" }),
        routine({ id: "silent", weekdays: ["Mon"], time: "07:00", alarm: "none" }),
        routine({ id: "untimed", weekdays: ["Mon"], alarm: "plain" }),
        routine({ id: "ticked", weekdays: ["Mon", "Tue"], time: "07:00", alarm: "walk" }),
        routine({ id: "past", weekdays: ["Mon"], time: "05:00", alarm: "plain" }),
        routine({ id: "late", title: "Late", weekdays: ["Mon", "Wed"], time: "02:00", alarm: "plain" }),
      ],
      routineChecks: [{ routineId: "ticked", date: "2026-10-19" }],
    }),
    from: "2026-10-19T06:00:00",
    days: 3,
  },
  {
    name: "in the night after Monday it is still Monday: Monday's tick silences its late routine",
    snapshot: snapshot({
      routines: [
        routine({ id: "late", weekdays: ["Mon"], time: "02:00", alarm: "plain" }),
        routine({ id: "later", weekdays: ["Mon"], time: "03:00", alarm: "walk" }),
      ],
      routineChecks: [{ routineId: "late", date: "2026-10-19" }],
    }),
    from: "2026-10-20T01:30:00",
    days: 1,
  },
  {
    name: "a ring skipped is silent, and the same alarm's next ring is not",
    snapshot: snapshot({
      routines: [routine({ id: "wake", weekdays: ["Mon", "Tue"], time: "07:00", alarm: "plain" })],
      alarms: [alarm({ id: "walk", time: "08:00", weekdays: ["Mon", "Tue"] })],
      skippedAlarms: [
        { key: "routine:wake@2026-10-19", date: "2026-10-19" },
        { key: "alarm:walk@2026-10-19", date: "2026-10-19" },
      ],
    }),
    from: "2026-10-19T06:00:00",
    days: 2,
  },
  {
    name: "the day starts at 6",
    snapshot: snapshot({ routines: [routine({ id: "early", weekdays: ["Mon"], time: "05:00", alarm: "plain" })], settings: { dayStartHour: 6, timeZone: null } }),
    from: "2026-10-19T06:00:00",
    days: 1,
  },
  {
    name: "the day starts at midnight",
    snapshot: snapshot({ routines: [routine({ id: "early", weekdays: ["Tue"], time: "00:30", alarm: "plain" })], settings: { dayStartHour: 0, timeZone: null } }),
    from: "2026-10-19T23:00:00",
    days: 2,
  },
  {
    name: "standalone alarms: recurring, one-off as Postgres writes it, switched off, beyond the window, past",
    snapshot: snapshot({
      alarms: [
        alarm({ id: "wake", label: "Wake up", kind: "situps", time: "06:00", weekdays: ["Tue", "Wed"] }),
        alarm({ id: "nap", at: "2026-10-19T10:00:00+00:00" }),
        alarm({ id: "precise", label: "Precise", at: "2026-10-20T01:30:00.123456+00:00" }),
        alarm({ id: "zulu", at: "2026-10-20T04:00:00Z" }),
        alarm({ id: "off", time: "07:00", weekdays: ["Tue"], enabled: false }),
        alarm({ id: "offOnce", at: "2026-10-20T03:00:00+00:00", enabled: false }),
        alarm({ id: "far", at: "2026-11-30T09:00:00+00:00" }),
        alarm({ id: "gone", at: "2026-10-19T00:00:00+00:00" }),
      ],
    }),
    from: "2026-10-19T06:00:00",
    days: 3,
  },
  {
    name: "deadlines: inside the window, beyond it, without an alarm time",
    snapshot: snapshot({
      deadlines: [
        deadline({ id: "soon", title: "Essay", dueDate: "2026-10-20", alarmTime: "09:00" }),
        deadline({ id: "edge", dueDate: "2026-10-25", alarmTime: "23:30" }),
        deadline({ id: "later", dueDate: "2026-10-26", alarmTime: "09:00" }),
        deadline({ id: "quiet", dueDate: "2026-10-20" }),
        deadline({ id: "overdue", dueDate: "2026-10-18", alarmTime: "09:00" }),
      ],
    }),
    from: "2026-10-19T06:00:00",
    days: 7,
  },
  {
    name: "meal reminders: anchors, a loop, a missing anchor, the default week, cancelled, cooked and emptied meals",
    snapshot: snapshot({
      kitchen: {
        ...emptyKitchen,
        recipes: [
          recipe("dal", "Dal", [reminder("prep", -45), reminder("soak", -60, "prep"), reminder("serve", 0)]),
          recipe("loop", "Loop", [reminder("a", -10, "b"), reminder("b", -10, "a")]),
          recipe("lost", "Lost", [reminder("orphan", -30, "nowhere")]),
        ],
        defaultWeek: [
          { weekday: "Mon", slot: "dinner", description: "dal", recipeIds: ["dal"] },
          { weekday: "Tue", slot: "breakfast", description: "dal", recipeIds: ["dal"] },
          { weekday: "Wed", slot: "dinner", description: "dal", recipeIds: ["dal"] },
        ],
        meals: [
          { id: "m1", date: "2026-10-19", slot: "lunch", description: "", status: "planned", recipeIds: ["loop", "dal", "lost"] },
          { id: "m2", date: "2026-10-20", slot: "breakfast", description: "", status: "cancelled", recipeIds: ["dal"] },
          { id: "m3", date: "2026-10-20", slot: "lunch", description: "", status: "cooked", recipeIds: ["dal"] },
          { id: "m4", date: "2026-10-21", slot: "dinner", description: "", status: "planned", recipeIds: [] },
        ],
      },
    }),
    from: "2026-10-19T08:00:00",
    days: 3,
  },
  {
    name: "a reminder after last night's dinner still rings after midnight",
    snapshot: snapshot({
      kitchen: {
        ...emptyKitchen,
        recipes: [recipe("ferment", "Batter", [reminder("grind", 360)])],
        defaultWeek: [{ weekday: "Mon", slot: "dinner", description: "dosa batter", recipeIds: ["ferment"] }],
      },
    }),
    from: "2026-10-20T00:30:00",
    days: 1,
  },
  {
    name: "equal times keep the order of their sources",
    snapshot: snapshot({
      alarms: [alarm({ id: "seven", time: "07:00", weekdays: ["Mon"] })],
      routines: [routine({ id: "seven", title: "Seven", weekdays: ["Mon"], time: "07:00", alarm: "walk" })],
      deadlines: [deadline({ id: "seven", dueDate: "2026-10-19", alarmTime: "07:00" })],
    }),
    from: "2026-10-19T06:00:00",
    days: 1,
  },
];

const local = (at: Date) => `${toISODate(at)}T${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}:${String(at.getSeconds()).padStart(2, "0")}`;

test("the phone's schedule cases are written from upcomingAlarms", () => {
  const fixtures = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cases: cases.map(({ name, snapshot, from, days }) => ({
      name,
      input: {
        settings: snapshot.settings,
        routines: snapshot.routines,
        routineChecks: snapshot.routineChecks,
        skippedAlarms: snapshot.skippedAlarms,
        alarms: snapshot.alarms,
        deadlines: snapshot.deadlines,
        kitchen: { recipes: snapshot.kitchen.recipes, defaultWeek: snapshot.kitchen.defaultWeek, meals: snapshot.kitchen.meals },
      },
      from,
      days,
      expected: upcomingAlarms(snapshot, new Date(from), days).map((alarm) => ({ ...alarm, at: local(alarm.at) })),
    })),
  };
  mkdirSync(dirname(FIXTURES), { recursive: true });
  writeFileSync(FIXTURES, `${JSON.stringify(fixtures, null, 2)}\n`);
  // Every case rings something, so a case that silently stopped testing anything shows
  for (const fixture of fixtures.cases) expect(fixture.expected.length, fixture.name).toBeGreaterThan(0);
});
