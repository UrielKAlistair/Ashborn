package dev.ashborn.app;

import static org.junit.Assert.assertEquals;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Scanner;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

// Schedule against the cases upcomingAlarms wrote (tests/unit/scheduleFixtures.spec.ts), so the
// phone rings what the app would have scheduled
public class ScheduleTest {
    // The keys are the app's ISO dates whatever the phone's language: one written in Arabic-Indic digits
    // would match no tick or skip
    @Test
    public void matchesUnderALocaleWithOtherDigits() throws Exception {
        Locale before = Locale.getDefault();
        Locale.setDefault(Locale.forLanguageTag("ar-EG"));
        try {
            matchesTheAppsSchedule();
        } finally {
            Locale.setDefault(before);
        }
    }

    @Test
    public void matchesTheAppsSchedule() throws Exception {
        JSONObject fixtures;
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("schedule-fixtures.json");
             Scanner scanner = new Scanner(in, StandardCharsets.UTF_8.name()).useDelimiter("\\A")) {
            fixtures = new JSONObject(scanner.next());
        }
        TimeZone.setDefault(TimeZone.getTimeZone(fixtures.getString("timeZone")));
        SimpleDateFormat local = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);

        JSONArray cases = fixtures.getJSONArray("cases");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject fixture = cases.getJSONObject(i);
            List<String> expected = new ArrayList<>();
            JSONArray alarms = fixture.getJSONArray("expected");
            for (int j = 0; j < alarms.length(); j++) {
                JSONObject alarm = alarms.getJSONObject(j);
                expected.add(alarm.getString("at") + " " + alarm.getString("key") + " | " + alarm.getString("title") + " | " + alarm.getString("kind"));
            }
            List<String> actual = new ArrayList<>();
            for (Alarm alarm : Schedule.upcoming(fixture.getJSONObject("input"), Schedule.instant(fixture.getString("from")), fixture.getInt("days"))) {
                actual.add(local.format(new Date(alarm.at)) + " " + alarm.key + " | " + alarm.title + " | " + alarm.kind);
            }
            assertEquals(fixture.getString("name"), expected, actual);
        }
    }
}
