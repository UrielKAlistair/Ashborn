/**
 * What the calendar shows, by day: the one-time alarms and the open deadlines. Repeating alarms,
 * routines and meal reminders stay off it: they would fill every day, and the Alarms screen lists them.
 * A one-time alarm falls on the calendar date of its moment; a deadline on its due date, which is a
 * day as the app counts days. Done deadlines are never in the snapshot, so every deadline here is open.
 */
import { addDays, clockOf, toISODate, week, weekdayOf } from "../../shared/dates";
import type { Alarm, ClockTime, Deadline, ISODate, Snapshot } from "../../shared/types";

export type CalendarEvent =
  | { kind: "alarm"; id: string; date: ISODate; time: ClockTime; title: string; alarm: Alarm }
  | { kind: "deadline"; id: string; date: ISODate; time: ClockTime | null; title: string; deadline: Deadline };

// Each day's events: deadlines first (they hold the whole day), then by time
export function calendarEvents(snapshot: Snapshot): Map<ISODate, CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  for (const alarm of snapshot.alarms) {
    if (!alarm.at) continue;
    const at = new Date(alarm.at);
    events.push({ kind: "alarm", id: alarm.id, date: toISODate(at), time: clockOf(at), title: alarm.label || "Alarm", alarm });
  }
  for (const deadline of snapshot.deadlines) {
    events.push({ kind: "deadline", id: deadline.id, date: deadline.dueDate, time: deadline.alarmTime, title: deadline.title, deadline });
  }
  const byDay = new Map<ISODate, CalendarEvent[]>();
  for (const event of events.sort(byWithinDay)) byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
  return byDay;
}

// The deadlines due before `today`, oldest first: they stay in sight until ticked or deleted
export function overdue(byDay: Map<ISODate, CalendarEvent[]>, today: ISODate): CalendarEvent[] {
  return [...byDay.entries()]
    .filter(([date]) => date < today)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, events]) => events.filter((event) => event.kind === "deadline"));
}

// The Monday on or before `date`, where a calendar week starts
export function weekStart(date: ISODate): ISODate {
  return addDays(date, -week.indexOf(weekdayOf(date)));
}

// The days of the month `date` falls in, padded out to whole weeks (Monday to Sunday)
export function monthGrid(date: ISODate): ISODate[] {
  const first = `${date.slice(0, 8)}01`;
  const nextFirst = addDays(first, 32).slice(0, 8) + "01";
  const days: ISODate[] = [];
  for (let day = weekStart(first); day < nextFirst || days.length % 7 !== 0; day = addDays(day, 1)) days.push(day);
  return days;
}

function byWithinDay(a: CalendarEvent, b: CalendarEvent) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
  return (a.time ?? "").localeCompare(b.time ?? "");
}

