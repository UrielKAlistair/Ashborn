import { expect, test } from "@playwright/test";
import { atTime, setTimeZone, startOfDay, toISODate } from "../../src/shared/dates";
import { emptyKitchen } from "../../src/shared/kitchen";
import { nextOccurrence, upcomingAlarms } from "../../src/shared/schedule";
import type { Snapshot } from "../../src/shared/types";

// Dates and clock times read in a set time zone, as the hosted agent server does, whatever the
// runtime's own zone

test.afterEach(() => setTimeZone(null));

test("in Kolkata, 20:00 UTC is 01:30 the next day", () => {
  setTimeZone("Asia/Kolkata");
  const moment = new Date("2026-10-28T20:00:00Z");
  expect(toISODate(moment)).toBe("2026-10-29");
  expect(startOfDay("2026-10-29").toISOString()).toBe("2026-10-28T18:30:00.000Z");
  expect(atTime("2026-10-29", "07:00").toISOString()).toBe("2026-10-29T01:30:00.000Z");
});

test("across a daylight-saving change the clock time keeps its local meaning", () => {
  setTimeZone("America/New_York");
  // Clocks went forward at 02:00 on 2026-03-08: 01:30 is EST (UTC-5), 03:30 is EDT (UTC-4)
  expect(atTime("2026-03-08", "01:30").toISOString()).toBe("2026-03-08T06:30:00.000Z");
  expect(atTime("2026-03-08", "03:30").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  expect(toISODate(new Date("2026-03-08T04:30:00Z"))).toBe("2026-03-07");
});

test("an alarm set for 07:00 from a UTC server rings at 07:00 for the user", () => {
  setTimeZone("Asia/Kolkata");
  // 23:00 IST on 28 October: the next 07:00 is the morning of the 29th
  expect(nextOccurrence("07:00", new Date("2026-10-28T17:30:00Z")).toISOString()).toBe("2026-10-29T01:30:00.000Z");
});

test("the schedule's days and times follow the set zone", () => {
  setTimeZone("Asia/Kolkata");
  const snapshot: Snapshot = {
    nodes: [],
    edges: [],
    routines: [{ id: "wake", title: "Wake", cue: "", weekdays: ["Thu"], time: "06:30", alarm: "plain" }],
    routineChecks: [],
    deadlines: [],
    alarms: [],
    skippedAlarms: [],
    kitchen: emptyKitchen,
    settings: { timeZone: "Asia/Kolkata" },
  };
  // 22:00 IST on Wednesday 28 October; Thursday's 06:30 is 01:00 UTC on the 29th
  const alarms = upcomingAlarms(snapshot, new Date("2026-10-28T16:30:00Z"), 2);
  expect(alarms.map((alarm) => `${alarm.key} ${alarm.at.toISOString()}`)).toEqual(["routine:wake@2026-10-29 2026-10-29T01:00:00.000Z"]);
});
