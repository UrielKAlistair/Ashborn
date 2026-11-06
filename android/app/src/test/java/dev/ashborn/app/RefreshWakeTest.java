package dev.ashborn.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

// When the background refresh wakes next, how long its requests may wait, and when it renews its access token
public class RefreshWakeTest {
    private static final long NOW = 1_800_000_000_000L;

    @Test
    public void wakesFifteenMinutesOn() {
        assertEquals(NOW + 15 * 60_000L, RefreshWake.nextWake(NOW, 0));
    }

    // Doze lets an app's allow-while-idle alarms through at most once per nine minutes
    @Test
    public void theWakeIsNoMoreOftenThanDozeAllows() {
        assertEquals(true, RefreshWake.nextWake(NOW, 0) - NOW >= 9 * 60_000L);
    }

    // The refresh stays out of a ring's way: going, fired but not yet ringing, or due within a minute
    @Test
    public void noRefreshWhileARingIsGoing() {
        assertEquals(true, RefreshWake.ringNear(true, 0, 0, NOW));
    }

    @Test
    public void noRefreshJustAfterAnAlarmFired() {
        assertEquals(true, RefreshWake.ringNear(false, NOW - 30_000, 0, NOW));
    }

    @Test
    public void noRefreshJustBeforeARingIsDue() {
        assertEquals(true, RefreshWake.ringNear(false, 0, NOW + 30_000, NOW));
    }

    @Test
    public void aRefreshWhenNoRingIsNear() {
        assertEquals(false, RefreshWake.ringNear(false, NOW - 5 * 60_000, NOW + 5 * 60_000, NOW));
        assertEquals(false, RefreshWake.ringNear(false, 0, 0, NOW));
    }

    @Test
    public void aRequestWaitsItsFullTimeoutWithoutADeadline() {
        assertEquals(15_000, AlarmRefreshWorker.timeout(Long.MAX_VALUE, NOW));
    }

    // Its connect and read timeouts together end by the deadline
    @Test
    public void aRequestWaitsOnlyUntilTheDeadline() {
        assertEquals(2_000, AlarmRefreshWorker.timeout(NOW + 4_000, NOW));
    }

    @Test
    public void pastTheDeadlineARequestIsNotMade() {
        assertEquals(0, AlarmRefreshWorker.timeout(NOW - 1, NOW));
    }

    // The access token is reused until five minutes before it expires; an unknown expiry renews it
    @Test
    public void anAccessTokenWithTimeLeftIsReused() {
        assertEquals(false, AlarmRefreshWorker.needsRenewing(NOW + 30 * 60_000L, NOW));
    }

    @Test
    public void anAccessTokenNearItsExpiryIsRenewed() {
        assertEquals(true, AlarmRefreshWorker.needsRenewing(NOW + 4 * 60_000L, NOW));
    }

    @Test
    public void anAccessTokenOfUnknownExpiryIsRenewed() {
        assertEquals(true, AlarmRefreshWorker.needsRenewing(0, NOW));
    }

    // A wake near a pending "Time's up" would hold it back in Doze, so it moves to nine minutes after it
    @Test
    public void aWakeKeepsClearOfATimeUp() {
        assertEquals(NOW + 29 * 60_000L, RefreshWake.nextWake(NOW, NOW + 20 * 60_000L));
        assertEquals(NOW + 19 * 60_000L, RefreshWake.nextWake(NOW, NOW + 10 * 60_000L));
        assertEquals(NOW + 15 * 60_000L, RefreshWake.nextWake(NOW, NOW + 5 * 60_000L));
        assertEquals(NOW + 15 * 60_000L, RefreshWake.nextWake(NOW, NOW + 40 * 60_000L));
    }
}
