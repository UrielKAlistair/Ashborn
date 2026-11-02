package dev.ashborn.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import org.json.JSONException;
import org.json.JSONObject;

// Rings an alarm until the app stops it: loops the alarm sound at alarm volume, vibrates, and
// shows the app over the lock screen. A plain alarm can also be dismissed or snoozed from its
// notification; one with a challenge only stopped from the app, once the challenge is done.
public class AlarmService extends Service {
    static final String ACTION_STOP = "dev.ashborn.app.STOP_ALARM";
    static final String ACTION_SNOOZE = "dev.ashborn.app.SNOOZE_ALARM";
    private static final String CHANNEL = "alarms";
    private static final int NOTIFICATION_ID = 1;

    private MediaPlayer player;
    private Vibrator vibrator;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopRinging();
            return START_NOT_STICKY;
        }
        if (ACTION_SNOOZE.equals(intent.getAction())) {
            snooze();
            return START_NOT_STICKY;
        }

        Alarm alarm;
        try {
            alarm = Alarm.fromJson(new JSONObject(intent.getStringExtra(AlarmScheduler.EXTRA_ALARM)));
            AlarmScheduler.setRinging(this, alarm);
        } catch (JSONException | NullPointerException e) {
            Log.e("Ashborn", "Bad alarm", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, notification(alarm), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        // An alarm that fires while another rings takes its place
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
            Intent stop = new Intent(this, AlarmService.class).setAction(ACTION_STOP);
            builder.addAction(0, "Dismiss", PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE));
            Intent snooze = new Intent(this, AlarmService.class).setAction(ACTION_SNOOZE);
            builder.addAction(0, "Snooze", PendingIntent.getService(this, 2, snooze, PendingIntent.FLAG_IMMUTABLE));
        }
        return builder.build();
    }

    private void startSound() {
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
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

    // Only a plain alarm snoozes: a challenge alarm is meant to get the user up
    private void snooze() {
        Alarm alarm = AlarmScheduler.ringing(this);
        if (alarm != null && "plain".equals(alarm.kind)) {
            try {
                AlarmScheduler.snooze(this, alarm);
            } catch (JSONException e) {
                Log.e("Ashborn", "Could not snooze the alarm", e);
            }
        }
        stopRinging();
    }

    private void stopRinging() {
        stopSound();
        try {
            AlarmScheduler.setRinging(this, null);
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
