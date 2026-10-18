import type { Weekday } from "../../src/shared/types.js";

export const week: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getWeekdayFromDate(date: string): Weekday {
  const weekdayIndex = new Date(`${date}T00:00:00`).getDay();

  return week[weekdayIndex === 0 ? 6 : weekdayIndex - 1];
}

export function getDateForDay(day: Weekday, anchorDate: string = getTodayDate()) {
  const today = new Date(`${anchorDate}T00:00:00`);
  const currentWeekIndex = week.indexOf(getWeekdayFromDate(anchorDate));
  const targetWeekIndex = week.indexOf(day);
  const targetDate = new Date(today);

  targetDate.setDate(today.getDate() + targetWeekIndex - currentWeekIndex);

  const year = targetDate.getFullYear();
  const month = `${targetDate.getMonth() + 1}`.padStart(2, "0");
  const dayOfMonth = `${targetDate.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${dayOfMonth}`;
}
