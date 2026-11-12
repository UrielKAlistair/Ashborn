package dev.ashborn.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;
import java.io.IOException;
import java.util.List;
import org.json.JSONException;

// Wakes the phone every 15 minutes, Doze or not, to run the background alarm refresh, so an alarm set
// late at night reaches the phone before it is due. The wake is an exact allow-while-idle alarm, not an
// alarm clock, so Android never shows it as the next alarm. One wake is pending at a time: each run arms
// the next first, and arming again replaces it. In Doze, a phone not exempt from battery optimisation
// has no network, so the wake then only arms the next. A change of time zone runs it too (manifest):
// the phone holds rings as instants, and a wall-clock alarm's instant moves with the zone; the stored
// rings move only once a refresh gets through (or the app is opened).
public class RefreshWake extends BroadcastReceiver {
    static final long INTERVAL_MS = 15 * 60_000L;
    // A receiver has about 10 s before Android counts it unresponsive, goAsync included; the refresh
    // gives up before that and the next wake tries again
    private static final long RUN_MS = 9_000;
    private static final long WAKE_LOCK_MS = 10_000;
    private static final int REQUEST_CODE = 0x5EF5E5;
    // How near a ring keeps the refresh off: a refresh that overran the receiver's limit would have the
    // process ended, and a ring going in it with it
    static final long RING_NEAR_MS = 60_000;

    // Sets the next wake, while the background refresh is connected
    static void arm(Context context) {
        if (!AlarmRefreshWorker.connected(context)) return;
        try {
            context.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextWake(System.currentTimeMillis()), wakeIntent(context));
        } catch (RuntimeException e) {
            // Exact alarms refused: the hourly job is left
            Log.e("Ashborn", "Could not set the refresh wake", e);
        }
    }

    static long nextWake(long now) {
        return now + INTERVAL_MS;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        arm(context);
        // In Doze the network is cut off unless the app is exempt from battery optimisation
        PowerManager power = context.getSystemService(PowerManager.class);
        long now = System.currentTimeMillis();
        boolean idle = power.isDeviceIdleMode(), exempt = power.isIgnoringBatteryOptimizations(context.getPackageName());
        if (idle && !exempt) {
            Diagnostics.wake(context, now, idle, exempt, "skipped: Doze without the battery exemption");
            return;
        }
        if (ringNear(AlarmService.ringing, AlarmReceiver.firedAt, nextRingAt(context), now)) {
            Diagnostics.wake(context, now, idle, exempt, "skipped: ring near");
            return;
        }

        PendingResult result = goAsync();
        PowerManager.WakeLock lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ashborn:refresh");
        lock.acquire(WAKE_LOCK_MS);
        long deadline = System.currentTimeMillis() + RUN_MS;
        new Thread(() -> {
            String outcome;
            try {
                outcome = AlarmRefreshWorker.refresh(context, deadline) ? "refreshed" : "busy or not connected";
            } catch (IOException | JSONException | RuntimeException e) {
                Log.e("Ashborn", "Woken alarm refresh failed", e);
                outcome = "failed: " + e.getMessage();
            }
            try {
                Diagnostics.wake(context, now, idle, exempt, outcome);
            } finally {
                if (lock.isHeld()) lock.release();
                result.finish();
            }
        }).start();
    }

    // Whether a ring is going, fired within RING_NEAR_MS without ringing yet, or due within RING_NEAR_MS
    // (`nextRingAt` 0 when none is scheduled)
    static boolean ringNear(boolean ringing, long firedAt, long nextRingAt, long now) {
        return ringing || now - firedAt < RING_NEAR_MS || (nextRingAt != 0 && nextRingAt - now < RING_NEAR_MS);
    }

    // The next ring the phone holds, in epoch ms; 0 when none is. An unreadable schedule counts as a
    // ring due now, so the refresh stays off.
    static long nextRingAt(Context context) {
        try {
            List<Alarm> next = AlarmScheduler.next(context, 1);
            return next.isEmpty() ? 0 : next.get(0).at;
        } catch (JSONException e) {
            return System.currentTimeMillis();
        }
    }

    private static PendingIntent wakeIntent(Context context) {
        Intent intent = new Intent(context, RefreshWake.class);
        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
