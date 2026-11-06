package dev.ashborn.app;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// The phone's copy of upcomingAlarms (src/shared/schedule.ts) and mealReminders
// (src/shared/kitchen.ts), for refreshing alarms while the app is closed. The two are kept in step
// by shared cases: tests/unit/scheduleFixtures.spec.ts writes them, ScheduleTest checks this
// class against them. The input is the snapshot's JSON, reduced to what the schedule reads:
// settings, routines, routineChecks, alarms, skippedAlarms, deadlines and kitchen (recipes, defaultWeek,
// meals).
final class Schedule {
    private static final String[] WEEKDAYS = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
    private static final String[] MEAL_SLOTS = {"breakfast", "lunch", "dinner"};
    private static final String[] MEAL_TIMES = {"08:00", "13:00", "20:00"};

    private Schedule() {}

    // The alarms due from `from` over the next `days` days, soonest first
    static List<Alarm> upcoming(JSONObject snapshot, long from, int days) throws JSONException {
        List<Alarm> alarms = new ArrayList<>();
        Set<String> checked = new HashSet<>();
        for (JSONObject check : objects(snapshot.getJSONArray("routineChecks"))) checked.add(check.getString("routineId") + "@" + check.getString("date"));
        Calendar start = calendarAt(from);
        int year = start.get(Calendar.YEAR), month = start.get(Calendar.MONTH), day = start.get(Calendar.DAY_OF_MONTH);

        List<JSONObject> standalone = objects(snapshot.getJSONArray("alarms"));
        for (int offset = 0; offset < days; offset++) {
            String date = isoDate(new GregorianCalendar(year, month, day + offset));
            for (JSONObject alarm : standalone) {
                String time = text(alarm, "time");
                if (!alarm.getBoolean("enabled") || time == null || !has(alarm.getJSONArray("weekdays"), weekdayOf(date))) continue;
                alarms.add(new Alarm("alarm:" + alarm.getString("id") + "@" + date, atTime(date, time), label(alarm), alarm.getString("kind")));
            }
        }
        int dayStartHour = snapshot.getJSONObject("settings").getInt("dayStartHour");
        String firstDay = dayOf(from, dayStartHour);
        for (int offset = 0; offset < days; offset++) {
            String date = addDays(firstDay, offset);
            for (JSONObject routine : objects(snapshot.getJSONArray("routines"))) {
                String time = text(routine, "time");
                if ("none".equals(routine.getString("alarm")) || time == null || !has(routine.getJSONArray("weekdays"), weekdayOf(date))) continue;
                String id = routine.getString("id");
                if (checked.contains(id + "@" + date)) continue;
                alarms.add(new Alarm("routine:" + id + "@" + date, onDayAt(date, time, dayStartHour), routine.getString("title"), routine.getString("alarm")));
            }
        }
        long end = new GregorianCalendar(year, month, day + days).getTimeInMillis();
        for (JSONObject alarm : standalone) {
            String at = text(alarm, "at");
            if (!alarm.getBoolean("enabled") || at == null || instant(at) >= end) continue;
            alarms.add(new Alarm("alarm:" + alarm.getString("id") + "@" + instant(at), instant(at), label(alarm), alarm.getString("kind")));
        }
        String lastDate = isoDate(new GregorianCalendar(year, month, day + days - 1));
        for (JSONObject deadline : objects(snapshot.getJSONArray("deadlines"))) {
            String time = text(deadline, "alarmTime");
            String due = deadline.getString("dueDate");
            if (time == null || due.compareTo(lastDate) > 0) continue;
            alarms.add(new Alarm("deadline:" + deadline.getString("id") + "@" + due, onDayAt(due, time, dayStartHour), "Due today: " + deadline.getString("title"), "plain"));
        }

        alarms.addAll(mealReminders(snapshot.getJSONObject("kitchen"), from, days));

        Set<String> skipped = new HashSet<>();
        for (JSONObject skip : objects(snapshot.getJSONArray("skippedAlarms"))) skipped.add(skip.getString("key"));
        List<Alarm> due = new ArrayList<>();
        for (Alarm alarm : alarms) if (alarm.at > from && !skipped.contains(alarm.key)) due.add(alarm);
        Collections.sort(due, (a, b) -> Long.compare(a.at, b.at));
        return due;
    }

    // The reminders of meals shown from the day before `from` over the next `days` days (a reminder
    // after last night's meal can ring after midnight; the caller drops past rings); a cancelled or
    // cooked meal rings nothing, nor does a meal with no recipe
    private static List<Alarm> mealReminders(JSONObject kitchen, long from, int days) throws JSONException {
        List<Alarm> reminders = new ArrayList<>();
        List<JSONObject> recipes = objects(kitchen.getJSONArray("recipes"));
        Calendar start = calendarAt(from);
        for (int offset = -1; offset < days; offset++) {
            String date = isoDate(new GregorianCalendar(start.get(Calendar.YEAR), start.get(Calendar.MONTH), start.get(Calendar.DAY_OF_MONTH) + offset));
            for (int s = 0; s < MEAL_SLOTS.length; s++) {
                String slot = MEAL_SLOTS[s];
                JSONObject meal = shownMeal(kitchen, date, slot);
                if (meal == null) continue;
                long mealAt = atTime(date, MEAL_TIMES[s]);
                for (JSONObject recipe : recipes) {
                    if (!has(meal.getJSONArray("recipeIds"), recipe.getString("id"))) continue;
                    List<JSONObject> list = objects(recipe.getJSONArray("reminders"));
                    Map<String, Long> offsets = reminderOffsets(list);
                    for (JSONObject reminder : list) {
                        Long minutes = offsets == null ? null : offsets.get(reminder.getString("id"));
                        reminders.add(new Alarm(
                            "meal:" + date + ":" + slot + ":" + reminder.getString("id"),
                            mealAt + (minutes == null ? 0 : minutes) * 60_000,
                            reminder.getString("label") + " (" + slot + ": " + recipe.getString("title") + ")",
                            "plain"));
                    }
                }
            }
        }
        return reminders;
    }

    // The date's own meal, or else the default week's for its weekday; null unless it is planned
    private static JSONObject shownMeal(JSONObject kitchen, String date, String slot) throws JSONException {
        for (JSONObject meal : objects(kitchen.getJSONArray("meals"))) {
            if (date.equals(meal.getString("date")) && slot.equals(meal.getString("slot"))) return "planned".equals(meal.getString("status")) ? meal : null;
        }
        String weekday = weekdayOf(date);
        for (JSONObject meal : objects(kitchen.getJSONArray("defaultWeek"))) {
            if (weekday.equals(meal.getString("weekday")) && slot.equals(meal.getString("slot"))) return meal;
        }
        return new JSONObject().put("recipeIds", new JSONArray());
    }

    // Each reminder's total offset in minutes from the meal's time, following anchors; null if
    // they loop
    private static Map<String, Long> reminderOffsets(List<JSONObject> reminders) throws JSONException {
        Map<String, JSONObject> byId = new HashMap<>();
        for (JSONObject reminder : reminders) byId.put(reminder.getString("id"), reminder);
        Map<String, Long> offsets = new HashMap<>();
        for (JSONObject reminder : reminders) {
            List<JSONObject> chain = new ArrayList<>();
            JSONObject current = reminder;
            while (current != null && !offsets.containsKey(current.getString("id"))) {
                if (chain.contains(current)) return null;
                chain.add(current);
                String anchor = text(current, "anchorId");
                current = anchor == null ? null : byId.get(anchor);
            }
            long base = current == null ? 0 : offsets.get(current.getString("id"));
            Collections.reverse(chain);
            for (JSONObject link : chain) {
                base += link.getLong("offsetMinutes");
                offsets.put(link.getString("id"), base);
            }
        }
        return offsets;
    }

    // When `time` falls on the day `date` (a routine's or a deadline's): within the day, which runs from the
    // day-start hour and so past midnight; 03:00 on a day starting at 04:00 is the night after it
    private static long onDayAt(String date, String time, int dayStartHour) {
        long at = atTime(date, time);
        return at < startOfDay(date, dayStartHour) ? atTime(addDays(date, 1), time) : at;
    }

    // Dates are local, as in src/shared/dates.ts: a Calendar built from out-of-range fields rolls
    // over the way JavaScript's Date does

    static String dayOf(long moment, int dayStartHour) {
        Calendar at = calendarAt(moment);
        return isoDate(new GregorianCalendar(at.get(Calendar.YEAR), at.get(Calendar.MONTH), at.get(Calendar.DAY_OF_MONTH), at.get(Calendar.HOUR_OF_DAY) - dayStartHour, at.get(Calendar.MINUTE)));
    }

    static String addDays(String date, int days) {
        int[] ymd = ymd(date);
        return isoDate(new GregorianCalendar(ymd[0], ymd[1] - 1, ymd[2] + days));
    }

    private static long startOfDay(String date, int dayStartHour) {
        int[] ymd = ymd(date);
        return new GregorianCalendar(ymd[0], ymd[1] - 1, ymd[2], dayStartHour, 0).getTimeInMillis();
    }

    // Clock times arrive as HH:MM, or HH:MM:SS from the database
    private static long atTime(String date, String time) {
        int[] ymd = ymd(date);
        int hours = Integer.parseInt(time.substring(0, 2)), minutes = Integer.parseInt(time.substring(3, 5));
        return new GregorianCalendar(ymd[0], ymd[1] - 1, ymd[2], hours, minutes).getTimeInMillis();
    }

    private static String weekdayOf(String date) {
        int[] ymd = ymd(date);
        return WEEKDAYS[new GregorianCalendar(ymd[0], ymd[1] - 1, ymd[2]).get(Calendar.DAY_OF_WEEK) - 1];
    }

    private static String isoDate(Calendar date) {
        return String.format("%04d-%02d-%02d", date.get(Calendar.YEAR), date.get(Calendar.MONTH) + 1, date.get(Calendar.DAY_OF_MONTH));
    }

    private static int[] ymd(String date) {
        return new int[] {Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)), Integer.parseInt(date.substring(8, 10))};
    }

    private static Calendar calendarAt(long moment) {
        Calendar at = new GregorianCalendar();
        at.setTimeInMillis(moment);
        return at;
    }

    // A timestamp as Postgres gives it (2026-10-21T01:30:00.123456+00:00), or with a Z, or local
    // when it has no zone, as JavaScript's Date reads it
    private static final Pattern TIMESTAMP = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|[+-]\\d{2}(?::?\\d{2})?)?");

    static long instant(String timestamp) {
        Matcher match = TIMESTAMP.matcher(timestamp);
        if (!match.matches()) throw new IllegalArgumentException("Bad timestamp " + timestamp);
        String zone = match.group(8);
        Calendar at = zone == null ? new GregorianCalendar() : new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        at.clear();
        at.set(Integer.parseInt(match.group(1)), Integer.parseInt(match.group(2)) - 1, Integer.parseInt(match.group(3)), Integer.parseInt(match.group(4)), Integer.parseInt(match.group(5)), match.group(6) == null ? 0 : Integer.parseInt(match.group(6)));
        long ms = at.getTimeInMillis();
        if (match.group(7) != null) ms += Integer.parseInt((match.group(7) + "00").substring(0, 3));
        if (zone != null && !zone.equals("Z")) {
            String digits = zone.replace(":", "");
            int sign = digits.charAt(0) == '-' ? -1 : 1;
            int hours = Integer.parseInt(digits.substring(1, 3)), minutes = digits.length() > 3 ? Integer.parseInt(digits.substring(3, 5)) : 0;
            ms -= sign * (hours * 60 + minutes) * 60_000L;
        }
        return ms;
    }

    private static String label(JSONObject alarm) throws JSONException {
        String label = text(alarm, "label");
        return label == null || label.isEmpty() ? "Alarm" : label;
    }

    private static String text(JSONObject object, String name) throws JSONException {
        return object.isNull(name) ? null : object.getString(name);
    }

    private static boolean has(JSONArray array, String value) throws JSONException {
        for (int i = 0; i < array.length(); i++) if (value.equals(array.getString(i))) return true;
        return false;
    }

    private static List<JSONObject> objects(JSONArray array) throws JSONException {
        List<JSONObject> list = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) list.add(array.getJSONObject(i));
        return list;
    }
}
