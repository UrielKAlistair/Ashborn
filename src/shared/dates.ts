/**
 * Dates and clock times, read in the user's time zone and with the user's day boundary.
 *
 * Two kinds of "day" exist. A calendar date (toISODate) is what a wall clock shows. An app day
 * (dayOf) starts at the day-start hour, 04:00 by default, so 01:00 still belongs to the day before:
 * routines, the to-do and progress count app days. Both settings are module state, because nearly
 * every caller wants the user's and passing them everywhere would thread them through the whole app:
 * the day-start hour is set whenever the data is shown; the time zone only by the hosted agent server,
 * since the app runs in the user's own zone.
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

// The hour the day turns over (user_settings.day_start_hour): before it, it is still the day
// before. Set from the snapshot once it is read.
export const DEFAULT_DAY_START_HOUR = 4;
let dayStartHour = DEFAULT_DAY_START_HOUR;

export function setDayStartHour(hour: number) {
  dayStartHour = hour;
}

// The day a moment belongs to
export function dayOf(moment: Date, startHour = dayStartHour): ISODate {
  const { year, month, day, hour, minute } = wallClock(moment);
  const shifted = new Date(Date.UTC(year, month - 1, day, hour - startHour, minute));
  return calendarDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

// The clock time a moment shows, HH:MM on a 24-hour clock
export function clockOf(moment: Date): string {
  const { hour, minute } = wallClock(moment);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function today(): ISODate {
  return dayOf(new Date());
}

// The moment a day begins
export function startOfDay(date: ISODate, startHour = dayStartHour): Date {
  return momentAt(date, startHour, 0);
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
// again at the result.
function momentAt(date: ISODate, hours: number, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  if (!timeZone) return new Date(year, month - 1, day, hours, minutes);
  const asUtc = Date.UTC(year, month - 1, day, hours, minutes);
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first));
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
