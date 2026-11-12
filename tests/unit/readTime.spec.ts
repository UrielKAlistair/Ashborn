import { expect, test } from "@playwright/test";
import { readTime } from "../../src/components/TimeField";
import { showTime } from "../../src/shared/dates";

// A typed time reads as HH:MM, 24-hour or with AM/PM, with or without the colon or a leading zero;
// anything else is no time
test("typed times", () => {
  const read = [
    ["7:30", "07:30"], ["0730", "07:30"], ["730", "07:30"], ["23:59", "23:59"], [" 00:00 ", "00:00"],
    ["7:30 pm", "19:30"], ["7:30 PM", "19:30"], ["7pm", "19:00"], ["730p", "19:30"], ["7.30 a.m.", "07:30"],
    ["12:15 AM", "00:15"], ["12 pm", "12:00"],
  ];
  for (const [typed, time] of read) expect(readTime(typed)).toBe(time);
  for (const typed of ["24:00", "12:60", "7", "7:3", "ab:cd", "", "13 pm", "0:30 am"]) expect(readTime(typed)).toBeNull();
});

// Shown on a 12-hour clock, and read back as it was
test("shown times", () => {
  for (const [time, shown] of [["00:30", "12:30 AM"], ["07:05", "7:05 AM"], ["12:00", "12:00 PM"], ["19:45", "7:45 PM"]]) {
    expect(showTime(time)).toBe(shown);
    expect(readTime(shown)).toBe(time);
  }
});
