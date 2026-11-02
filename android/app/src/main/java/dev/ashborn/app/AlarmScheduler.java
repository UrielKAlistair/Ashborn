package dev.ashborn.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// Keeps Android's alarm clock in step with the app: the scheduled alarms and the one ringing
// now are stored on the phone, so they survive the app closing and are re-armed after a reboot.
// The app and the background refresh both schedule, so scheduling is synchronized.
final class AlarmScheduler {
    private static final String PREFS = "ashborn-alarms";
    private static final String SCHEDULED = "scheduled";
    private static final String RINGING = "ringing";
    private static final String SNOOZED = "snoozed";
    private static final String SNOOZE_PREFIX = "snooze:";
    private static final long SNOOZE_MS = 10 * 60_000;

    static final String EXTRA_ALARM = "alarm";

    private AlarmScheduler() {}

    // Replaces every scheduled alarm with `alarms`, plus the snoozed alarms still to ring, which
    // the app's schedule does not know about
    static synchronized void schedule(Context context, List<Alarm> alarms) throws JSONException {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        for (Alarm old : load(context, SCHEDULED)) manager.cancel(fireIntent(context, old));

        long now = System.currentTimeMillis();
        Map<String, Alarm> byKey = new LinkedHashMap<>();
        for (Alarm alarm : alarms) byKey.put(alarm.key, alarm);
        JSONArray snoozed = new JSONArray();
        for (Alarm alarm : load(context, SNOOZED)) {
            if (alarm.at <= now) continue;
            byKey.put(alarm.key, alarm);
            snoozed.put(alarm.toJson());
        }

        JSONArray kept = new JSONArray();
        for (Alarm alarm : byKey.values()) {
            if (alarm.at <= now) continue;
            manager.setAlarmClock(new AlarmManager.AlarmClockInfo(alarm.at, openAppIntent(context)), fireIntent(context, alarm));
            kept.put(alarm.toJson());
        }
        prefs(context).edit().putString(SCHEDULED, kept.toString()).putString(SNOOZED, snoozed.toString()).apply();
    }

    // After a reboot Android has forgotten the alarms; set the stored ones again
    static void rearm(Context context) throws JSONException {
        schedule(context, load(context, SCHEDULED));
    }

    // Rings `alarm` again in ten minutes. Snoozing a snoozed alarm moves it rather than adding one.
    static synchronized void snooze(Context context, Alarm alarm) throws JSONException {
        String key = alarm.key.startsWith(SNOOZE_PREFIX) ? alarm.key : SNOOZE_PREFIX + alarm.key;
        List<Alarm> snoozed = new ArrayList<>();
        for (Alarm other : load(context, SNOOZED)) if (!other.key.equals(key)) snoozed.add(other);
        snoozed.add(new Alarm(key, System.currentTimeMillis() + SNOOZE_MS, alarm.title, alarm.kind));
        JSONArray array = new JSONArray();
        for (Alarm other : snoozed) array.put(other.toJson());
        prefs(context).edit().putString(SNOOZED, array.toString()).apply();
        schedule(context, load(context, SCHEDULED));
    }

    static void setRinging(Context context, Alarm alarm) throws JSONException {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (alarm == null) editor.remove(RINGING);
        else editor.putString(RINGING, alarm.toJson().toString());
        editor.apply();
    }

    static Alarm ringing(Context context) {
        String json = prefs(context).getString(RINGING, null);
        try {
            return json == null ? null : Alarm.fromJson(new JSONObject(json));
        } catch (JSONException e) {
            return null;
        }
    }

    static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent fireIntent(Context context, Alarm alarm) throws JSONException {
        Intent intent = new Intent(context, AlarmReceiver.class).putExtra(EXTRA_ALARM, alarm.toJson().toString());
        return PendingIntent.getBroadcast(context, alarm.key.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static List<Alarm> load(Context context, String name) throws JSONException {
        JSONArray array = new JSONArray(prefs(context).getString(name, "[]"));
        List<Alarm> alarms = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) alarms.add(Alarm.fromJson(array.getJSONObject(i)));
        return alarms;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
