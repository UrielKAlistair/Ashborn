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
// the next first, and arming again replaces it.
public class RefreshWake extends BroadcastReceiver {
    static final long INTERVAL_MS = 15 * 60_000L;
    // In Doze one app's allow-while-idle alarms fire at most once per nine minutes, and TimeUp uses one
    // too, so a wake is kept this far from a pending "Time's up", which would otherwise wait for it
    static final long IDLE_SPACING_MS = 9 * 60_000L;
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
            context.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextWake(System.currentTimeMillis(), TimeUp.pendingAt(context)), wakeIntent(context));
        } catch (RuntimeException e) {
            // Exact alarms refused: the hourly job is left
            Log.e("Ashborn", "Could not set the refresh wake", e);
        }
    }

    // `timeUpAt` is the pending "Time's up" in epoch ms, 0 if none
    static long nextWake(long now, long timeUpAt) {
        long wake = now + INTERVAL_MS;
        if (timeUpAt > now && Math.abs(wake - timeUpAt) < IDLE_SPACING_MS) wake = timeUpAt + IDLE_SPACING_MS;
        return wake;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        arm(context);
        // In Doze the network is cut off unless the app is exempt from battery optimisation
        PowerManager power = context.getSystemService(PowerManager.class);
        if (power.isDeviceIdleMode() && !power.isIgnoringBatteryOptimizations(context.getPackageName())) return;
        if (ringNear(AlarmService.ringing, AlarmReceiver.firedAt, nextRingAt(context), System.currentTimeMillis())) return;

        PendingResult result = goAsync();
        PowerManager.WakeLock lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ashborn:refresh");
        lock.acquire(WAKE_LOCK_MS);
        long deadline = System.currentTimeMillis() + RUN_MS;
        new Thread(() -> {
            try {
                AlarmRefreshWorker.refresh(context, deadline);
            } catch (IOException | JSONException | RuntimeException e) {
                Log.e("Ashborn", "Woken alarm refresh failed", e);
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
    private static long nextRingAt(Context context) {
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
