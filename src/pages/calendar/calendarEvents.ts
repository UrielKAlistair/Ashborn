/**
 * What the calendar shows, by day: the one-time alarms, the events, one-time and repeating, and the
 * open deadlines. Repeating rings, routines and meal reminders stay off it: they would fill every day,
 * and a day's own view (DayRings) lists them. An event's start alarm shows as its event.
 * A one-time alarm or event falls on the calendar date of its start; a deadline on its due date, which
 * is a day as the app counts days. Done deadlines are never in the snapshot, so every deadline here is open.
 */
import { addDays, atTime, clockOf, toISODate, week, weekdayOf } from "../../shared/dates";
import type { Alarm, ClockTime, Deadline, ISODate, ScheduleEvent, Snapshot } from "../../shared/types";

export type CalendarEvent =
  | { kind: "alarm"; id: string; date: ISODate; time: ClockTime; at: Date; title: string; alarm: Alarm }
  | { kind: "event"; id: string; date: ISODate; time: ClockTime; at: Date; title: string; event: ScheduleEvent }
  | { kind: "deadline"; id: string; date: ISODate; time: ClockTime | null; title: string; deadline: Deadline };

// The dated events by day, and the repeating events, which fall on every matching weekday
export type CalendarDays = { byDay: Map<ISODate, CalendarEvent[]>; repeating: ScheduleEvent[] };

// Each day's dated events: deadlines first (they hold the whole day), then by time
export function calendarEvents(snapshot: Snapshot): CalendarDays {
  const events: CalendarEvent[] = [];
  for (const alarm of snapshot.alarms) {
    if (!alarm.at || alarm.eventId) continue;
    const at = new Date(alarm.at);
    events.push({ kind: "alarm", id: alarm.id, date: toISODate(at), time: clockOf(at), at, title: alarm.label || "Alarm", alarm });
  }
  for (const event of snapshot.events) {
    if (!event.at) continue;
    const at = new Date(event.at);
    events.push({ kind: "event", id: event.id, date: toISODate(at), time: clockOf(at), at, title: event.title || "Event", event });
  }
  for (const deadline of snapshot.deadlines) {
    events.push({ kind: "deadline", id: deadline.id, date: deadline.dueDate, time: deadline.alarmTime, title: deadline.title, deadline });
  }
  const byDay = new Map<ISODate, CalendarEvent[]>();
  for (const event of events.sort(byWithinDay)) byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
  const repeating = snapshot.events.filter((event) => event.time);
  return { byDay, repeating };
}

// A day's events: its dated ones and the repeating events that fall on its weekday
export function dayEvents({ byDay, repeating }: CalendarDays, date: ISODate): CalendarEvent[] {
  const own = byDay.get(date) ?? [];
  const weekday = weekdayOf(date);
  const repeats = repeating
    .filter((event) => event.weekdays.includes(weekday))
    .map((event): CalendarEvent => ({ kind: "event", id: event.id, date, time: event.time!, at: atTime(date, event.time!), title: event.title || "Event", event }));
  return repeats.length === 0 ? own : [...own, ...repeats].sort(byWithinDay);
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

