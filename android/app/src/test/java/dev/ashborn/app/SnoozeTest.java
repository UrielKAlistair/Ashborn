package dev.ashborn.app;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

// Which snoozes ring again when the schedule is replaced
public class SnoozeTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final Alarm WAKE = new Alarm("snooze:routine:wake@2026-11-04", NOW + 5 * 60_000, "Wake up", "walk");
    private static final Alarm PILLS = new Alarm("snooze:alarm:pills@2026-11-04", NOW + 8 * 60_000, "Pills", "plain");

    @Test
    public void aSnoozeRingsWhileItsRingIsStillScheduled() {
        assertEquals(keys(WAKE, PILLS), keys(AlarmScheduler.stillSnoozed(Arrays.asList(WAKE, PILLS), set("routine:wake@2026-11-04", "alarm:pills@2026-11-04"), NOW)));
    }

    // Its ring left the schedule: the routine was ticked, the ring skipped, or the alarm removed
    @Test
    public void aSnoozeStopsOnceItsRingLeavesTheSchedule() {
        assertEquals(keys(PILLS), keys(AlarmScheduler.stillSnoozed(Arrays.asList(WAKE, PILLS), set("alarm:pills@2026-11-04"), NOW)));
    }

    @Test
    public void aSnoozeAlreadyDueIsDropped() {
        assertEquals(keys(), keys(AlarmScheduler.stillSnoozed(Arrays.asList(WAKE), set("routine:wake@2026-11-04"), WAKE.at)));
    }

    // Rings snoozed together are snoozed one by one, so each stops with its own ring
    @Test
    public void joinedRingsSnoozeEachUnderItsOwnKey() {
        Alarm water = new Alarm("alarm:water@2026-11-04", NOW, "Water", "plain");
        Alarm bins = new Alarm("alarm:bins@2026-11-04", NOW, "Bins", "plain");
        List<Alarm> snoozed = AlarmScheduler.snoozedWith(new ArrayList<>(), Arrays.asList(water, bins), NOW + 600_000);
        assertEquals(Arrays.asList("snooze:alarm:water@2026-11-04", "snooze:alarm:bins@2026-11-04"), keys(snoozed));
        assertEquals(NOW + 600_000, snoozed.get(1).at);
    }

    @Test
    public void snoozingASnoozedRingMovesIt() {
        List<Alarm> snoozed = AlarmScheduler.snoozedWith(Arrays.asList(WAKE, PILLS), Arrays.asList(PILLS), NOW + 600_000);
        assertEquals(Arrays.asList(WAKE.key, PILLS.key), keys(snoozed));
        assertEquals(NOW + 600_000, snoozed.get(1).at);
    }

    private static Set<String> set(String... keys) {
        return new HashSet<>(Arrays.asList(keys));
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
