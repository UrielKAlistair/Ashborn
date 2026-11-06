package dev.ashborn.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.app.NotificationCompat;

// Says "Time's up" when Now's timer ends, the app open or not: a notification on a channel of its
// own, which sounds as a message does (silent on silent, a buzz on vibrate) and never rings. One is
// pending at a time: setting it again replaces it and takes down one already shown.
public class TimeUp extends BroadcastReceiver {
    private static final String CHANNEL = "time-up";
    private static final int REQUEST_CODE = 0x71E0F;
    private static final int NOTIFICATION_ID = 0x71E0F;
    private static final String EXTRA_TITLE = "title";
    private static final String PREFS = "ashborn-time-up";
    private static final String AT = "at";
    private static final String TITLE = "title";

    // Notifies at `at` (epoch ms) that the box on `title` has ended; a time already past only clears
    static void set(Context context, long at, String title) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        alarms.cancel(pending(context, title));
        context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        boolean ahead = at > System.currentTimeMillis();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(AT, ahead ? at : 0).putString(TITLE, title).apply();
        // The refresh wake keeps clear of it (RefreshWake.IDLE_SPACING_MS)
        RefreshWake.arm(context);
        if (!ahead) return;
        try {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(context, title));
        } catch (RuntimeException e) {
            // Exact alarms refused: the card in the app still says it when opened
            Log.e("Ashborn", "Could not set the time's-up notice", e);
        }
    }

    // After a reboot or an update Android has forgotten the pending notice; set it again
    static void rearm(Context context) {
        long at = pendingAt(context);
        if (at > 0) set(context, at, context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TITLE, ""));
    }

    // When the pending notice is due, in epoch ms; 0 if none is
    static long pendingAt(Context context) {
        long at = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(AT, 0);
        return at > System.currentTimeMillis() ? at : 0;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "Time's up", NotificationManager.IMPORTANCE_HIGH));
        String title = intent.getStringExtra(EXTRA_TITLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_ashborn)
            .setContentTitle(title == null || title.isEmpty() ? "Time's up" : "Time's up: " + title)
            .setContentText("Done, or keep going?")
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(AlarmScheduler.openAppIntent(context));
        try {
            notifications.notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            // Notifications not allowed
            Log.e("Ashborn", "Could not show the time's-up notice", e);
        }
    }

    private static PendingIntent pending(Context context, String title) {
        Intent intent = new Intent(context, TimeUp.class).putExtra(EXTRA_TITLE, title);
        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
