package dev.ashborn.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.content.ContextCompat;
import org.json.JSONException;

// Wakes when an alarm is due (and starts it ringing), or when the phone has rebooted or the app been
// updated (and re-arms the schedule and the background refresh's wakes, which either may have cleared)
public class AlarmReceiver extends BroadcastReceiver {
    // When an alarm last fired, in epoch ms, before AlarmService has it ringing (RefreshWake)
    static volatile long firedAt = 0;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            try {
                AlarmScheduler.rearm(context);
            } catch (JSONException e) {
                Log.e("Ashborn", "Could not re-arm alarms", e);
            }
            TimeUp.rearm(context);
            RefreshWake.arm(context);
            return;
        }

        firedAt = System.currentTimeMillis();
        Intent ring = new Intent(context, AlarmService.class).putExtra(AlarmScheduler.EXTRA_ALARM, intent.getStringExtra(AlarmScheduler.EXTRA_ALARM));
        ContextCompat.startForegroundService(context, ring);
    }
}
