/**
 * Dates and clock times, read in the user's time zone. A day runs from midnight to midnight.
 *
 * The time zone is module state, because nearly every caller wants the user's and passing it
 * everywhere would thread it through the whole app; only the hosted agent server sets it, since the
 * app runs in the user's own zone.
 * Calendar arithmetic runs on UTC midnights, where every day is 24 hours; conversion to and from real
 * moments goes through the time zone, daylight saving included.
 */
import type { ISODate, Weekday } from "./types.js";

export const week: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The time zone dates and clock times are read in (user_settings.time_zone). Unset, it is the
// runtime's own, as on the user's devices; the hosted agent server runs in UTC and sets the user's.
let timeZone: string | null = null;

export function setTimeZone(zone: string | null) {
  timeZone = zone;
}

export function currentTimeZone(): string | undefined {
  return timeZone ?? undefined;
}

// The date a moment falls on
export function toISODate(date: Date): ISODate {
  const { year, month, day } = wallClock(date);
  return calendarDate(year, month, day);
}

// The clock time a moment shows, HH:MM on a 24-hour clock
export function clockOf(moment: Date): string {
  const { hour, minute } = wallClock(moment);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// A clock time as it is shown, on a 12-hour clock: "19:05" reads "7:05 PM", "00:30" reads "12:30 AM"
export function showTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

// The moment a day begins, its midnight
export function startOfDay(date: ISODate): Date {
  return momentAt(date, 0, 0);
}

// The moment the clock shows `time` (HH:MM) on `date`
export function atTime(date: ISODate, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return momentAt(date, hours, minutes);
}

export function addDays(date: ISODate, days: number): ISODate {
  const at = new Date(utcMidnight(date) + days * 86_400_000);
  return calendarDate(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

export function weekdayOf(date: ISODate): Weekday {
  const index = new Date(utcMidnight(date)).getUTCDay();

  return week[index === 0 ? 6 : index - 1];
}

// Minutes from `start` to `end` (clock times), past midnight if `end` is earlier; null if they are equal
export function minutesFrom(start: string, end: string): number | null {
  const minutes = (toMinutes(end) - toMinutes(start) + 1440) % 1440;
  return minutes === 0 ? null : minutes;
}

// The clock time `minutes` after `start`
export function clockAfter(start: string, minutes: number): string {
  const total = (toMinutes(start) + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Whole days from `from` to `to`; negative when `to` is earlier
export function daysBetween(from: ISODate, to: ISODate) {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);
}

// Calendar arithmetic is done on UTC midnights, where every day is 24 hours long
function utcMidnight(date: ISODate) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function calendarDate(year: number, month: number, day: number): ISODate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

// What a clock in the time zone shows at a moment
function wallClock(moment: Date): WallClock {
  if (!timeZone) {
    return { year: moment.getFullYear(), month: moment.getMonth() + 1, day: moment.getDate(), hour: moment.getHours(), minute: moment.getMinutes() };
  }
  const parts = Object.fromEntries(zoneFormat(timeZone).formatToParts(moment).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

// The moment a clock in the time zone shows `hours`:`minutes` on `date`. Out-of-range fields roll
// over, as Date's do. Across a daylight-saving change the zone's offset is read at the guess and
// again at the result; when the two reads differ, the time falls in the gap the clocks skip, and it
// is read after the change (the later candidate), as Date reads it.
function momentAt(date: ISODate, hours: number, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  if (!timeZone) return new Date(year, month - 1, day, hours, minutes);
  const asUtc = Date.UTC(year, month - 1, day, hours, minutes);
  const first = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(first);
  return new Date(offsetAt(second) === offsetAt(first) ? second : Math.max(first, second));
}

// How far the time zone's clock is ahead of UTC at a moment, in milliseconds
function offsetAt(ms: number) {
  const { year, month, day, hour, minute } = wallClock(new Date(ms));
  return Date.UTC(year, month - 1, day, hour, minute) - Math.floor(ms / 60_000) * 60_000;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(zone: string) {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    formats.set(zone, format);
  }
  return format;
}
