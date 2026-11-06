package dev.ashborn.app;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

// Which stored alarms Settings shows as the next the phone will ring
public class HeldTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final Alarm RANG = new Alarm("alarm:rang@2026-11-04", NOW - 60_000, "Rang", "plain");
    private static final Alarm WAKE = new Alarm("routine:wake@2026-11-05", NOW + 3 * 3_600_000, "Wake up", "walk");
    private static final Alarm PILLS = new Alarm("alarm:pills@2026-11-05", NOW + 5 * 3_600_000, "Pills", "plain");
    private static final Alarm SNOOZED = new Alarm("snooze:alarm:tea@2026-11-04", NOW + 5 * 60_000, "Tea", "plain");

    // The schedule reaches a day back, so rings already rung are left out; a snooze sorts in by its time
    @Test
    public void onlyAlarmsStillToRingSoonestFirst() {
        assertEquals(keys(SNOOZED, WAKE, PILLS), keys(AlarmScheduler.next(Arrays.asList(RANG, PILLS, WAKE), Arrays.asList(SNOOZED), NOW, 5)));
    }

    @Test
    public void cutToTheCountAsked() {
        assertEquals(keys(SNOOZED, WAKE), keys(AlarmScheduler.next(Arrays.asList(PILLS, WAKE), Arrays.asList(SNOOZED), NOW, 2)));
    }

    @Test
    public void anAlarmDueNowHasRung() {
        assertEquals(keys(), keys(AlarmScheduler.next(Arrays.asList(WAKE), new ArrayList<>(), WAKE.at, 5)));
    }

    private static List<String> keys(Alarm... alarms) {
        return keys(Arrays.asList(alarms));
    }

    private static List<String> keys(List<Alarm> alarms) {
        List<String> keys = new ArrayList<>();
        for (Alarm alarm : alarms) keys.add(alarm.key);
        return keys;
    }
}
