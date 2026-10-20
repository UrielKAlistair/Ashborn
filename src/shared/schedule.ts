import { toISODate, weekdayOf } from "./dates.js";
import { mealReminders } from "./kitchen.js";
import type { AlarmKind, ISODate, Routine, Snapshot } from "./types.js";

// One ring of an alarm: a timed routine on one of its days, a deadline on its due day, or a
// reminder of a recipe for a planned meal
export type AlarmInstance = {
  key: string; // stable per source and day, so rescheduling replaces rather than duplicates
  at: Date;
  title: string;
  kind: Exclude<AlarmKind, "none">;
};

// Timed routines first, in time order; untimed ones after, in the order they were made
export function byTime(a: Routine, b: Routine) {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  return a.time ? -1 : b.time ? 1 : 0;
}

// The alarms due from `from` over the next `days` days, soonest first: standalone alarms that are
// on, timed routines, deadlines with an alarm, and meal reminders. A routine already ticked that
// day does not ring.
export function upcomingAlarms(snapshot: Snapshot, from: Date, days: number): AlarmInstance[] {
  const alarms: AlarmInstance[] = [];
  const checked = new Set(snapshot.routineChecks.map((check) => `${check.routineId}@${check.date}`));

  for (let offset = 0; offset < days; offset++) {
    const date = toISODate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset));
    for (const alarm of snapshot.alarms) {
      if (!alarm.enabled || !alarm.time || !alarm.weekdays.includes(weekdayOf(date))) continue;
      alarms.push({ key: `alarm:${alarm.id}@${date}`, at: atTime(date, alarm.time), title: alarm.label || "Alarm", kind: alarm.kind });
    }
    for (const routine of snapshot.routines) {
      if (routine.alarm === "none" || !routine.time || !routine.weekdays.includes(weekdayOf(date))) continue;
      if (checked.has(`${routine.id}@${date}`)) continue;
      alarms.push({ key: `routine:${routine.id}@${date}`, at: atTime(date, routine.time), title: routine.title, kind: routine.alarm });
    }
  }
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  for (const alarm of snapshot.alarms) {
    if (!alarm.enabled || !alarm.at || new Date(alarm.at) >= end) continue;
    alarms.push({ key: `alarm:${alarm.id}`, at: new Date(alarm.at), title: alarm.label || "Alarm", kind: alarm.kind });
  }
  const lastDate = toISODate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days - 1));
  for (const deadline of snapshot.deadlines) {
    if (!deadline.alarmTime || deadline.dueDate > lastDate) continue;
    alarms.push({ key: `deadline:${deadline.id}`, at: atTime(deadline.dueDate, deadline.alarmTime), title: `Due today: ${deadline.title}`, kind: "plain" });
  }

  for (const reminder of mealReminders(snapshot.kitchen, from, days)) alarms.push({ ...reminder, kind: "plain" });

  return alarms.filter((alarm) => alarm.at > from).sort((a, b) => a.at.getTime() - b.at.getTime());
}

// The next moment the clock shows `time`: today if it is still ahead, else tomorrow
export function nextOccurrence(time: string, now = new Date()) {
  const [hours, minutes] = time.split(":").map(Number);
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (at <= now) at.setDate(at.getDate() + 1);
  return at;
}

function atTime(date: ISODate, time: string) {
  return new Date(`${date}T${time}:00`);
}
