/**
 * The alarm schedule: every ring due in the next few days, worked out from the snapshot alone, so the
 * app, the phone's background refresh (a Java mirror in Schedule.java) and the tests agree on it.
 * Sources are standalone alarms (recurring and one-off), timed routines, deadlines with an alarm
 * time, and recipe reminders of planned meals. Each ring has a stable key, which is how a skip, a
 * snooze and the phone's stored schedule name it.
 */
import { addDays, atTime, dayOf, showTime, startOfDay, toISODate, weekdayOf } from "./dates.js";
import { mealReminders } from "./kitchen.js";
import type { AlarmKind, AlarmSound, ISODate, Routine, Snapshot } from "./types.js";

// How far back the schedule handed to the phone reaches: the rings already rung that are still due
// say which snoozes may ring again (none whose ring was ticked, skipped or removed since), so the
// snapshot holds the one-off alarms and routine ticks of that span too
export const RING_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// One ring of an alarm: a timed routine on one of its days, a deadline on its due day, or a
// reminder of a recipe for a planned meal
export type AlarmInstance = {
  key: string; // stable per source and ring (its day, or a one-off's moment), so rescheduling replaces rather than duplicates, and a skip follows the ring, not a moved one
  at: Date;
  title: string;
  kind: Exclude<AlarmKind, "none">;
  sound: AlarmSound;
};

// A ring moved to another time on its day is skipped, and rings as a one-off alarm named for it, so
// putting it back can find and delete that alarm
export const movedLabel = (title: string, time: string) => `${title} (moved from ${showTime(time)})`;

// Timed routines first, in time order; untimed ones after, in the order they were made
export function byTime(a: Routine, b: Routine) {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  return a.time ? -1 : b.time ? 1 : 0;
}

// The alarms due from `from` over the next `days` days, soonest first: standalone alarms that are
// on, timed routines, deadlines with an alarm, and meal reminders. A routine already ticked that
// day does not ring, nor does a ring skipped. Alarms keep the calendar; a routine belongs to a day as the app counts days, so
// one timed before the day-start hour rings in the night after its day.
export function upcomingAlarms(snapshot: Snapshot, from: Date, days: number): AlarmInstance[] {
  const alarms: AlarmInstance[] = [];
  const checked = new Set(snapshot.routineChecks.map((check) => `${check.routineId}@${check.date}`));

  const firstDate = toISODate(from);
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(firstDate, offset);
    for (const alarm of snapshot.alarms) {
      if (!alarm.enabled || !alarm.time || !alarm.weekdays.includes(weekdayOf(date))) continue;
      alarms.push({ key: `alarm:${alarm.id}@${date}`, at: atTime(date, alarm.time), title: alarm.label || "Alarm", kind: alarm.kind, sound: alarm.sound });
    }
  }
  const { dayStartHour } = snapshot.settings;
  const firstDay = dayOf(from, dayStartHour);
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(firstDay, offset);
    for (const routine of snapshot.routines) {
      if (routine.alarm === "none" || !routine.time || !routine.weekdays.includes(weekdayOf(date))) continue;
      if (checked.has(`${routine.id}@${date}`)) continue;
      alarms.push({ key: `routine:${routine.id}@${date}`, at: onDayAt(date, routine.time, dayStartHour), title: routine.title, kind: routine.alarm, sound: "default" });
    }
  }
  const end = startOfDay(addDays(firstDate, days), 0);
  for (const alarm of snapshot.alarms) {
    if (!alarm.enabled || !alarm.at || new Date(alarm.at) >= end) continue;
    alarms.push({ key: `alarm:${alarm.id}@${new Date(alarm.at).getTime()}`, at: new Date(alarm.at), title: alarm.label || "Alarm", kind: alarm.kind, sound: alarm.sound });
  }
  const lastDate = addDays(firstDate, days - 1);
  for (const deadline of snapshot.deadlines) {
    if (!deadline.alarmTime || deadline.dueDate > lastDate) continue;
    alarms.push({ key: `deadline:${deadline.id}@${deadline.dueDate}`, at: onDayAt(deadline.dueDate, deadline.alarmTime, dayStartHour), title: `Due today: ${deadline.title}`, kind: "plain", sound: "default" });
  }

  for (const reminder of mealReminders(snapshot.kitchen, from, days)) alarms.push({ ...reminder, kind: "plain", sound: "default" });

  const skipped = new Set(snapshot.skippedAlarms.map((skip) => skip.key));
  return alarms.filter((alarm) => alarm.at > from && !skipped.has(alarm.key)).sort((a, b) => a.at.getTime() - b.at.getTime());
}

// The next moment the clock shows `time`: today if it is still ahead, else tomorrow
export function nextOccurrence(time: string, now = new Date()) {
  const at = atTime(toISODate(now), time);
  return at > now ? at : atTime(addDays(toISODate(now), 1), time);
}

// When `time` falls on the day `date` (a routine's or a deadline's): within the day, which runs from the
// day-start hour and so past midnight; 03:00 on a day starting at 04:00 is the night after it
export function onDayAt(date: ISODate, time: string, dayStartHour: number) {
  const at = atTime(date, time);
  return at < startOfDay(date, dayStartHour) ? atTime(addDays(date, 1), time) : at;
}
