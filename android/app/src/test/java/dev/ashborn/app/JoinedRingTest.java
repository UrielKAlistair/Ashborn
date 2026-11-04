package dev.ashborn.app;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import org.junit.Test;

// Alarms that go off together ring as one
public class JoinedRingTest {
    private static final Alarm WAKE = new Alarm("routine:wake@2026-11-04", 1_000, "Wake up", "situps");
    private static final Alarm PILLS = new Alarm("alarm:pills@2026-11-04", 2_000, "Pills", "plain");
    private static final Alarm WALK = new Alarm("alarm:walk@2026-11-04", 3_000, "Walk", "walk");
    private static final Alarm WATER = new Alarm("alarm:water@2026-11-04", 4_000, "Water", "plain");
    private static final Alarm BINS = new Alarm("alarm:bins@2026-11-04", 5_000, "Bins", "plain");

    @Test
    public void theHardestStopWinsWhicheverFiredFirst() {
        assertEquals("situps", Alarm.joined(Arrays.asList(PILLS, WAKE)).kind);
        assertEquals("situps", Alarm.joined(Arrays.asList(WAKE, PILLS, WALK)).kind);
        assertEquals("walk", Alarm.joined(Arrays.asList(PILLS, WALK)).kind);
        assertEquals("plain", Alarm.joined(Arrays.asList(PILLS, WATER)).kind);
    }

    // The first's key and time, so the ringing screen carries on rather than starting again
    @Test
    public void keepsTheFirstRingsKeyAndTime() {
        Alarm joined = Alarm.joined(Arrays.asList(PILLS, WAKE));
        assertEquals(PILLS.key, joined.key);
        assertEquals(PILLS.at, joined.at);
    }

    // A stop given for the ring the user saw can't end a harder one that joined since
    @Test
    public void aStopForAnEasierRingThanTheOneGoingOffIsRefused() {
        assertEquals(false, Alarm.stopAllowed("plain", Arrays.asList(PILLS, WAKE)));
        assertEquals(false, Alarm.stopAllowed("walk", Arrays.asList(WALK, WAKE)));
        assertEquals(true, Alarm.stopAllowed("situps", Arrays.asList(PILLS, WAKE)));
        assertEquals(true, Alarm.stopAllowed("plain", Arrays.asList(PILLS, WATER)));
        // Nothing ringing: the stop only clears up
        assertEquals(true, Alarm.stopAllowed("plain", Arrays.asList()));
    }

    @Test
    public void namesThreeThenCountsTheRest() {
        assertEquals("Pills", Alarm.joined(Arrays.asList(PILLS)).title);
        assertEquals("Wake up + Pills + Walk", Alarm.joined(Arrays.asList(WAKE, PILLS, WALK)).title);
        assertEquals("Wake up + Pills + Walk + 2 more", Alarm.joined(Arrays.asList(WAKE, PILLS, WALK, WATER, BINS)).title);
    }
}
