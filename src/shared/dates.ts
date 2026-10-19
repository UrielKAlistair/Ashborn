import type { ISODate, Weekday } from "./types.js";

export const week: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function toISODate(date: Date): ISODate {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function weekdayOf(date: ISODate): Weekday {
  const index = new Date(`${date}T00:00:00`).getDay();

  return week[index === 0 ? 6 : index - 1];
}

// Whole days from `from` to `to`; negative when `to` is earlier
export function daysBetween(from: ISODate, to: ISODate) {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime();

  return Math.round(ms / 86_400_000);
}
