package dev.ashborn.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.content.ContextCompat;
import org.json.JSONException;
import org.json.JSONObject;

// Wakes when an alarm is due (and starts it ringing, or reports a call fired too late as missed), or when the phone has rebooted or the app been
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
            RefreshWake.arm(context);
            return;
        }

        firedAt = System.currentTimeMillis();
        String json = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM);
        try {
            Alarm alarm = Alarm.fromJson(new JSONObject(json));
            if (alarm.isCall()) AlarmScheduler.fired(context, alarm.key);
            if (AlarmService.staleCall(alarm, firedAt)) {
                AlarmService.notifyMissed(context, alarm);
                return;
            }
        } catch (JSONException | NullPointerException e) {
            // AlarmService reports a bad alarm
        }
        Intent ring = new Intent(context, AlarmService.class).putExtra(AlarmScheduler.EXTRA_ALARM, json);
        ContextCompat.startForegroundService(context, ring);
    }
}
