package dev.ashborn.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.content.ContextCompat;
import org.json.JSONException;

// Wakes when an alarm is due (and starts it ringing) or when the phone has rebooted (and
// re-arms the schedule)
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            try {
                AlarmScheduler.rearm(context);
            } catch (JSONException e) {
                Log.e("Ashborn", "Could not re-arm alarms", e);
            }
            return;
        }

        Intent ring = new Intent(context, AlarmService.class).putExtra(AlarmScheduler.EXTRA_ALARM, intent.getStringExtra(AlarmScheduler.EXTRA_ALARM));
        ContextCompat.startForegroundService(context, ring);
    }
}
