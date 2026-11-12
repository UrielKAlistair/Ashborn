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
        assertEquals(false, Alarm.stopAllowed(PILLS.key, "plain", Arrays.asList(PILLS, WAKE)));
        assertEquals(false, Alarm.stopAllowed(WALK.key, "walk", Arrays.asList(WALK, WAKE)));
        assertEquals(true, Alarm.stopAllowed(PILLS.key, "situps", Arrays.asList(PILLS, WAKE)));
        assertEquals(true, Alarm.stopAllowed(PILLS.key, "plain", Arrays.asList(PILLS, WATER)));
        // Nothing ringing: the stop only clears up
        assertEquals(true, Alarm.stopAllowed(PILLS.key, "plain", Arrays.asList()));
    }

    // A stop given for a ring that has ended can't end the different one going off now
    @Test
    public void aStopForARingNoLongerGoingIsRefused() {
        assertEquals(false, Alarm.stopAllowed(PILLS.key, "plain", Arrays.asList(WATER)));
        assertEquals(false, Alarm.stopAllowed(null, "plain", Arrays.asList(WATER)));
        assertEquals(true, Alarm.stopAllowed(WATER.key, "plain", Arrays.asList(WATER, PILLS)));
    }

    @Test
    public void namesThreeThenCountsTheRest() {
        assertEquals("Pills", Alarm.joined(Arrays.asList(PILLS)).title);
        assertEquals("Wake up + Pills + Walk", Alarm.joined(Arrays.asList(WAKE, PILLS, WALK)).title);
        assertEquals("Wake up + Pills + Walk + 2 more", Alarm.joined(Arrays.asList(WAKE, PILLS, WALK, WATER, BINS)).title);
    }

    private static final Alarm CALL = new Alarm("alarm:call@6000", 6_000, "Claude needs you", "plain", Alarm.CALL);

    @Test
    public void aCallJoiningMakesTheRingACall() {
        assertEquals(Alarm.CALL, Alarm.joined(Arrays.asList(PILLS, CALL)).sound);
        assertEquals(Alarm.DEFAULT, Alarm.joined(Arrays.asList(PILLS, WATER)).sound);
    }

    // A call rings briefly, but never cuts a real alarm going off with it short
    @Test
    public void ringsForTheLongestOfItsParts() {
        assertEquals(AlarmService.CALL_RING_MS, AlarmService.ringMs(Arrays.asList(CALL)));
        assertEquals(AlarmService.RING_MS, AlarmService.ringMs(Arrays.asList(CALL, PILLS)));
        assertEquals(AlarmService.CHALLENGE_RING_MS, AlarmService.ringMs(Arrays.asList(CALL, WAKE)));
    }

    @Test
    public void aCallIsNeverSnoozed() {
        assertEquals(true, AlarmService.snoozable(Alarm.joined(Arrays.asList(PILLS, WATER))));
        assertEquals(false, AlarmService.snoozable(Alarm.joined(Arrays.asList(CALL))));
        assertEquals(false, AlarmService.snoozable(Alarm.joined(Arrays.asList(PILLS, CALL))));
        assertEquals(false, AlarmService.snoozable(Alarm.joined(Arrays.asList(PILLS, WAKE))));
    }

    @Test
    public void onlyACallFiredTooLateIsStale() {
        assertEquals(false, AlarmService.staleCall(CALL, CALL.at + AlarmService.CALL_STALE_MS));
        assertEquals(true, AlarmService.staleCall(CALL, CALL.at + AlarmService.CALL_STALE_MS + 1));
        assertEquals(false, AlarmService.staleCall(PILLS, PILLS.at + 60 * 60_000));
    }
}
