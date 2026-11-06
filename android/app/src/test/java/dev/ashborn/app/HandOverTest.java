package dev.ashborn.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

// Which set alarms a new schedule cancels: setting a key again replaces its alarm, so only those
// leaving are cancelled, and a ring falling due while the schedule is handed over still rings
public class HandOverTest {
    private static final long NOW = 1_800_000_000_000L;
    private static Alarm at(long at) {
        return new Alarm("alarm:tea@2026-11-06", at, "Tea", "plain");
    }

    @Test
    public void aRingDueAsTheScheduleArrivesIsKept() {
        assertFalse(AlarmScheduler.leaves(at(NOW - 20), at(NOW - 20), NOW));
    }

    @Test
    public void anAlarmStillAheadIsReplacedNotCancelled() {
        assertFalse(AlarmScheduler.leaves(at(NOW + 60_000), at(NOW + 120_000), NOW));
    }

    @Test
    public void aRemovedAlarmIsCancelled() {
        assertTrue(AlarmScheduler.leaves(at(NOW + 60_000), null, NOW));
    }

    @Test
    public void anAlarmMovedIntoThePastIsCancelled() {
        assertTrue(AlarmScheduler.leaves(at(NOW + 60_000), at(NOW - 60_000), NOW));
    }
}
