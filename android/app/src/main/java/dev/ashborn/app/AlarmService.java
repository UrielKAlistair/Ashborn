package dev.ashborn.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

// Rings an alarm until the app stops it: loops the alarm sound as the ringer allows, vibrates, and
// shows the app over the lock screen. A plain alarm can also be dismissed or snoozed from its
// notification; one with a challenge only stopped from the app, once the challenge is done. An
// alarm that fires while another rings joins it: one ring, named for both, with the harder stop,
// and stopping it stops both.
public class AlarmService extends Service {
    static final String ACTION_STOP = "dev.ashborn.app.STOP_ALARM";
    static final String ACTION_SNOOZE = "dev.ashborn.app.SNOOZE_ALARM";
    // The stop of the ring the user saw when stopping or snoozing it
    static final String EXTRA_SHOWN_KIND = "shownKind";
    private static final String CHANNEL = "alarms";
    private static final int NOTIFICATION_ID = 1;

    private MediaPlayer player;
    private Vibrator vibrator;
    // The rings going off now, in the order they fired
    private final List<Alarm> parts = new ArrayList<>();

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopRinging();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(intent.getAction()) || ACTION_SNOOZE.equals(intent.getAction())) {
            // Ignored when a harder ring joined after the user saw this one: the screen then shows its challenge
            if (!Alarm.stopAllowed(intent.getStringExtra(EXTRA_SHOWN_KIND), parts)) return START_STICKY;
            if (ACTION_STOP.equals(intent.getAction())) stopRinging();
            else snooze();
            return START_NOT_STICKY;
        }

        try {
            parts.add(Alarm.fromJson(new JSONObject(intent.getStringExtra(AlarmScheduler.EXTRA_ALARM))));
            AlarmScheduler.setRinging(this, parts);
        } catch (JSONException | NullPointerException e) {
            Log.e("Ashborn", "Bad alarm", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, notification(Alarm.joined(parts)), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        // The sound starts again for each ring that joins
        stopSound();
        startSound();
        vibrator = getSystemService(Vibrator.class);
        vibrator.vibrate(VibrationEffect.createWaveform(new long[] {0, 800, 600}, 0));
        return START_STICKY;
    }

    private Notification notification(Alarm alarm) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Alarms", NotificationManager.IMPORTANCE_HIGH);
        channel.setSound(null, null); // the service plays the sound itself, looping
        manager.createNotificationChannel(channel);

        PendingIntent open = AlarmScheduler.openAppIntent(this);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(alarm.title)
            .setContentText("plain".equals(alarm.kind) ? "Alarm" : "Open Ashborn to stop it")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setContentIntent(open)
            .setFullScreenIntent(open, true);
        if ("plain".equals(alarm.kind)) {
            Intent stop = new Intent(this, AlarmService.class).setAction(ACTION_STOP).putExtra(EXTRA_SHOWN_KIND, alarm.kind);
            builder.addAction(0, "Dismiss", PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE));
            Intent snooze = new Intent(this, AlarmService.class).setAction(ACTION_SNOOZE).putExtra(EXTRA_SHOWN_KIND, alarm.kind);
            builder.addAction(0, "Snooze", PendingIntent.getService(this, 2, snooze, PendingIntent.FLAG_IMMUTABLE));
        }
        return builder.build();
    }

    // On silent or vibrate an alarm only vibrates. The sound plays on the ringtone stream, so the
    // ringer's volume and Do Not Disturb apply to it as to a call.
    private void startSound() {
        if (getSystemService(AudioManager.class).getRingerMode() != AudioManager.RINGER_MODE_NORMAL) return;
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            Log.e("Ashborn", "Could not play the alarm sound", e);
        }
    }

    private void stopSound() {
        if (player != null) {
            player.release();
            player = null;
        }
        if (vibrator != null) vibrator.cancel();
    }

    // Only a plain ring snoozes (one whose every part is plain): a challenge alarm is meant to get the user up
    private void snooze() {
        if (!parts.isEmpty() && "plain".equals(Alarm.joined(parts).kind)) {
            try {
                AlarmScheduler.snooze(this, parts);
            } catch (JSONException e) {
                Log.e("Ashborn", "Could not snooze the alarm", e);
            }
        }
        stopRinging();
    }

    private void stopRinging() {
        stopSound();
        parts.clear();
        try {
            AlarmScheduler.setRinging(this, parts);
        } catch (JSONException e) {
            Log.e("Ashborn", "Could not clear the ringing alarm", e);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopSound();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
