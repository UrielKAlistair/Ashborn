package dev.ashborn.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.os.Build;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationAttributes;
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
// and stopping it stops both. Left alone, a ring stops itself after it last started (ringMs: the
// longest of its parts') and leaves a "Missed" notification, which sounds as a message does, not as
// an alarm. A call (an agent calling the user) plays the app's own clip once, as the ringer allows,
// rings for the clip's length, and cannot be snoozed.
public class AlarmService extends Service {
    static final long RING_MS = 5 * 60_000;
    static final long CHALLENGE_RING_MS = 15 * 60_000;
    // The call clip (res/raw/call) lasts 23.5 s
    static final long CALL_RING_MS = 24_000;
    // A call this late (the phone was off or out of reach) is reported missed instead of ringing
    static final long CALL_STALE_MS = 2 * 60_000;
    static final String ACTION_STOP = "dev.ashborn.app.STOP_ALARM";
    static final String ACTION_SNOOZE = "dev.ashborn.app.SNOOZE_ALARM";
    // The stop of the ring the user saw when stopping or snoozing it
    static final String EXTRA_SHOWN_KIND = "shownKind";
    static final String EXTRA_SHOWN_KEY = "shownKey";
    static final String CHANNEL = "alarms";
    private static final int NOTIFICATION_ID = 1;

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    // The latest start, which the ring's own timeout stops by
    private int lastStartId;
    private final Runnable timeout = () -> {
        notifyMissed(this, Alarm.joined(this.parts));
        stopRinging(lastStartId);
    };
    static final String MISSED_CHANNEL = "missed-alarms";
    // Each missed ring has a notice of its own, by its key, clear of the ringing notification's id
    private static int missedNotificationId(Alarm alarm) {
        return (alarm.key.hashCode() & 0x7fffffff) | 0x10000;
    }
    // The rings going off now, in the order they fired
    private final List<Alarm> parts = new ArrayList<>();
    // Whether a ring is going, for the background refresh to stay out of its way (RefreshWake)
    static volatile boolean ringing = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        lastStartId = startId;
        if (intent == null) {
            stopRinging(startId);
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(intent.getAction()) || ACTION_SNOOZE.equals(intent.getAction())) {
            // Ignored when a harder ring joined after the user saw this one: the screen then shows its challenge
            if (!Alarm.stopAllowed(intent.getStringExtra(EXTRA_SHOWN_KEY), intent.getStringExtra(EXTRA_SHOWN_KIND), parts)) return START_STICKY;
            if (ACTION_STOP.equals(intent.getAction())) stopRinging(startId);
            else snooze(startId);
            return START_NOT_STICKY;
        }

        try {
            parts.add(Alarm.fromJson(new JSONObject(intent.getStringExtra(AlarmScheduler.EXTRA_ALARM))));
            ringing = true;
            AlarmScheduler.setRinging(this, parts);
        } catch (JSONException | NullPointerException e) {
            Log.e("Ashborn", "Bad alarm", e);
            // A ring already going keeps going. Otherwise the service was started to the foreground and
            // must get there before it stops, or the system ends the app.
            if (!parts.isEmpty()) return START_STICKY;
            createChannel();
            toForeground(new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_ashborn).setContentTitle("Alarm").build());
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        Alarm ring = Alarm.joined(parts);
        boolean challenge = !"plain".equals(ring.kind);
        toForeground(notification(ring));
        MainActivity.ringStarted();
        // The sound starts again for each ring that joins
        stopSound();
        startSound(challenge, ring.isCall());
        startVibrating();
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, ringMs(parts));
        return START_STICKY;
    }

    // A service's type is given from Android 10 on, where it is needed
    private void toForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION_ID, notification);
    }

    private void createChannel() {
        createChannel(this);
    }

    // Making it again changes nothing the user has set on it; Settings makes it early, so it can be
    // checked and set before the first ring
    static void createChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Alarms", NotificationManager.IMPORTANCE_HIGH);
        channel.setSound(null, null); // the service plays the sound itself, looping
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    // How long rings going off together ring unanswered: the longest of their parts', so a call never
    // cuts a real alarm short
    static long ringMs(List<Alarm> parts) {
        long longest = 0;
        for (Alarm part : parts) {
            long ms = part.isCall() ? CALL_RING_MS : "plain".equals(part.kind) ? RING_MS : CHALLENGE_RING_MS;
            longest = Math.max(longest, ms);
        }
        return longest;
    }

    // Whether `alarm`, firing at `now`, is a call too late to ring
    static boolean staleCall(Alarm alarm, long now) {
        return alarm.isCall() && now - alarm.at > CALL_STALE_MS;
    }

    // Says a ring went unanswered: on a channel of its own, which sounds as a message does and never
    // rings. A call says who called, with the call's message.
    static void notifyMissed(Context context, Alarm alarm) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(MISSED_CHANNEL, "Missed alarms", NotificationManager.IMPORTANCE_DEFAULT));
        String time = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(new java.util.Date(alarm.at));
        try {
            notifications.notify(missedNotificationId(alarm), new NotificationCompat.Builder(context, MISSED_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_ashborn)
                .setContentTitle(alarm.isCall() ? "Missed call from Claude" : "Missed: " + alarm.title)
                .setContentText(alarm.isCall() ? alarm.title + " (" + time + ")" : "Rang at " + time + ", unanswered")
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(AlarmScheduler.openAppIntent(context))
                .build());
        } catch (SecurityException e) {
            // Notifications not allowed
            Log.e("Ashborn", "Could not show the missed-alarm notice", e);
        }
    }

    private Notification notification(Alarm alarm) {
        createChannel();

        PendingIntent open = AlarmScheduler.openAppIntent(this);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_ashborn)
            .setContentTitle(alarm.title)
            .setContentText(!"plain".equals(alarm.kind) ? "Open Ashborn to stop it" : alarm.isCall() ? "Call from Claude" : "Alarm")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setContentIntent(open)
            .setFullScreenIntent(open, true);
        if ("plain".equals(alarm.kind)) {
            // Updated each time, so the buttons carry this ring's key rather than the first ring's
            int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
            Intent stop = new Intent(this, AlarmService.class).setAction(ACTION_STOP).putExtra(EXTRA_SHOWN_KEY, alarm.key).putExtra(EXTRA_SHOWN_KIND, alarm.kind);
            builder.addAction(0, "Dismiss", PendingIntent.getService(this, 1, stop, flags));
        }
        if (snoozable(alarm)) {
            int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
            Intent snooze = new Intent(this, AlarmService.class).setAction(ACTION_SNOOZE).putExtra(EXTRA_SHOWN_KEY, alarm.key).putExtra(EXTRA_SHOWN_KIND, alarm.kind);
            builder.addAction(0, "Snooze", PendingIntent.getService(this, 2, snooze, flags));
        }
        return builder.build();
    }

    // A plain alarm on silent or vibrate only vibrates: its sound plays on the ringtone stream, so the
    // ringer's volume and Do Not Disturb apply to it as to a call. A challenge alarm sounds in every
    // ringer mode, on the alarm stream: its own volume, and Do Not Disturb only if that blocks alarms.
    // Either plays on the phone's own speaker, even with earbuds or a Bluetooth speaker connected.
    // A call plays the app's tune (res/raw/call) instead of the phone's alarm sound.
    private void startSound(boolean challenge, boolean call) {
        AudioManager audio = getSystemService(AudioManager.class);
        if (!challenge && audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL) return;
        Uri sound = call ? Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.call) : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            int usage = challenge ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_NOTIFICATION_RINGTONE;
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            if (Build.VERSION.SDK_INT >= 28) player.setPreferredDevice(builtInSpeaker(audio));
            player.setDataSource(this, sound);
            player.setLooping(!call);
            // A call rung together with a real alarm goes on with the alarm's sound once the clip ends
            if (call) player.setOnCompletionListener(done -> {
                if (ringMs(parts) > CALL_RING_MS) {
                    stopSound();
                    startSound(challenge, false);
                    startVibrating();
                }
            });
            player.prepare();
            player.start();
        } catch (Exception e) {
            Log.e("Ashborn", "Could not play the alarm sound", e);
        }
    }

    // The phone's own speaker, or null (the system's choice) on a phone that lists none
    private static AudioDeviceInfo builtInSpeaker(AudioManager audio) {
        for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return device;
        }
        return null;
    }

    // Vibrates in every ringer mode, silent too. Marked as an alarm's vibration, which Android lets through
    // from an app in the background and turns off only with the system's own alarm-vibration setting.
    @SuppressWarnings("deprecation")
    private void startVibrating() {
        vibrator = getSystemService(Vibrator.class);
        VibrationEffect pattern = VibrationEffect.createWaveform(new long[] {0, 800, 600}, 0);
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(pattern, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        else vibrator.vibrate(pattern, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
    }

    private void stopSound() {
        if (player != null) {
            player.release();
            player = null;
        }
        if (vibrator != null) vibrator.cancel();
    }

    // Only a plain ring that is not a call snoozes: a challenge alarm is meant to get the user up, and a
    // call is over once missed. Snoozing one that can't stops it.
    static boolean snoozable(Alarm ring) {
        return "plain".equals(ring.kind) && !ring.isCall();
    }

    private void snooze(int startId) {
        if (!parts.isEmpty() && snoozable(Alarm.joined(parts))) {
            try {
                AlarmScheduler.snooze(this, parts);
            } catch (JSONException e) {
                Log.e("Ashborn", "Could not snooze the alarm", e);
            }
        }
        stopRinging(startId);
    }

    // Stops only if no newer start arrived meanwhile: a ring firing as this one is stopped still rings
    private void stopRinging(int startId) {
        handler.removeCallbacks(timeout);
        stopSound();
        parts.clear();
        ringing = false;
        try {
            AlarmScheduler.setRinging(this, parts);
        } catch (JSONException e) {
            Log.e("Ashborn", "Could not clear the ringing alarm", e);
        }
        MainActivity.ringEnded();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf(startId);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeout);
        stopSound();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
