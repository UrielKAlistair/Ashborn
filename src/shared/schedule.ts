/**
 * The alarm schedule: every ring due in the next few days, worked out from the snapshot alone, so the
 * app, the phone's background refresh (a Java mirror in Schedule.java) and the tests agree on it.
 * Sources are standalone alarms (recurring and one-off), timed routines, deadlines with an alarm
 * time, and recipe reminders of planned meals. Each ring has a stable key, which is how a skip, a
 * snooze and the phone's stored schedule name it.
 */
import { addDays, atTime, showTime, startOfDay, toISODate, weekdayOf } from "./dates.js";
import { mealReminders } from "./kitchen.js";
import type { AlarmKind, AlarmSound, ISODate, Routine, ScheduleEvent, Snapshot } from "./types.js";

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
// on (an event's start alarm among them), timed routines, deadlines with an alarm, and meal reminders. A routine already ticked that
// day does not ring, nor does a ring skipped.
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
    for (const routine of snapshot.routines) {
      if (routine.alarm === "none" || !routine.time || !routine.weekdays.includes(weekdayOf(date))) continue;
      if (checked.has(`${routine.id}@${date}`)) continue;
      alarms.push({ key: `routine:${routine.id}@${date}`, at: atTime(date, routine.time), title: routine.title, kind: routine.alarm, sound: "default" });
    }
  }
  const end = startOfDay(addDays(firstDate, days));
  for (const alarm of snapshot.alarms) {
    if (!alarm.enabled || !alarm.at || new Date(alarm.at) >= end) continue;
    alarms.push({ key: `alarm:${alarm.id}@${new Date(alarm.at).getTime()}`, at: new Date(alarm.at), title: alarm.label || "Alarm", kind: alarm.kind, sound: alarm.sound });
  }
  const lastDate = addDays(firstDate, days - 1);
  for (const deadline of snapshot.deadlines) {
    if (!deadline.alarmTime || deadline.dueDate > lastDate) continue;
    alarms.push({ key: `deadline:${deadline.id}@${deadline.dueDate}`, at: atTime(deadline.dueDate, deadline.alarmTime), title: `Due today: ${deadline.title}`, kind: "plain", sound: "default" });
  }

  for (const reminder of mealReminders(snapshot.kitchen, from, days)) alarms.push({ ...reminder, kind: "plain", sound: "default" });

  const skipped = new Set(snapshot.skippedAlarms.map((skip) => skip.key));
  return alarms.filter((alarm) => alarm.at > from && !skipped.has(alarm.key)).sort((a, b) => a.at.getTime() - b.at.getTime());
}

// One event on one day: its start, how long it lasts (null: a moment) and the event
export type DayEvent = { key: string; at: Date; minutes: number | null; title: string; event: ScheduleEvent };

// The events on `date`, in time order: the repeating ones on its weekday, and the one-offs that start on it
export function eventsOn(snapshot: Snapshot, date: ISODate): DayEvent[] {
  const events: DayEvent[] = [];
  for (const event of snapshot.events) {
    const title = event.title || "Event";
    if (event.time && event.weekdays.includes(weekdayOf(date))) events.push({ key: `event:${event.id}@${date}`, at: atTime(date, event.time), minutes: event.minutes, title, event });
    else if (event.at && toISODate(new Date(event.at)) === date) events.push({ key: `event:${event.id}@${Date.parse(event.at)}`, at: new Date(event.at), minutes: event.minutes, title, event });
  }
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// Where the line for now goes among a day's rows, in order of start: before row `row` (the first not
// yet started; the row count when all have), or, when the last row started is an event still on,
// across that row at `inside`, the share of its length gone (0 to 1). So the line stays below every
// row that has started: an alarm that rings during an event pushes it below that alarm.
export type NowPlace = { row: number; inside: number | null };
export function nowPlace(rows: { at: Date; minutes?: number | null }[], now: Date): NowPlace {
  const started = rows.filter((row) => row.at <= now).length;
  const last = rows[started - 1];
  const lasts = last?.minutes ? last.minutes * 60_000 : 0;
  if (last && now.getTime() < last.at.getTime() + lasts) return { row: started - 1, inside: (now.getTime() - last.at.getTime()) / lasts };
  return { row: started, inside: null };
}

// The next moment the clock shows `time`: today if it is still ahead, else tomorrow
export function nextOccurrence(time: string, now = new Date()) {
  const at = atTime(toISODate(now), time);
  return at > now ? at : atTime(addDays(toISODate(now), 1), time);
}
