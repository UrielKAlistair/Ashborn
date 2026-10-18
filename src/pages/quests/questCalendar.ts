import type { ISODateString, Weekday } from "../../shared/types.js";

export const week: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function getTodayDate(): ISODateString {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getWeekdayFromDate(date: ISODateString): Weekday {
  const weekdayIndex = new Date(`${date}T00:00:00`).getDay();

  return week[weekdayIndex === 0 ? 6 : weekdayIndex - 1];
}

export function getDateForDay(day: Weekday, anchorDate: ISODateString = getTodayDate()) {
  const today = new Date(`${anchorDate}T00:00:00`);
  const todayIndex = getWeekdayFromDate(anchorDate);
  const currentWeekIndex = week.indexOf(todayIndex);
  const targetWeekIndex = week.indexOf(day);
  const delta = targetWeekIndex - currentWeekIndex;
  const targetDate = new Date(today);

  targetDate.setDate(today.getDate() + delta);

  const year = targetDate.getFullYear();
  const month = `${targetDate.getMonth() + 1}`.padStart(2, "0");
  const dayOfMonth = `${targetDate.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${dayOfMonth}`;
}
