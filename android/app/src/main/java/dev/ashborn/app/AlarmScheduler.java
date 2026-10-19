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
import java.util.List;

// Keeps Android's alarm clock in step with the app: the scheduled alarms and the one ringing
// now are stored on the phone, so they survive the app closing and are re-armed after a reboot.
final class AlarmScheduler {
    private static final String PREFS = "ashborn-alarms";
    private static final String SCHEDULED = "scheduled";
    private static final String RINGING = "ringing";

    static final String EXTRA_ALARM = "alarm";

    private AlarmScheduler() {}

    // Replaces every scheduled alarm with `alarms`
    static void schedule(Context context, List<Alarm> alarms) throws JSONException {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        for (Alarm old : load(context, SCHEDULED)) manager.cancel(fireIntent(context, old));

        long now = System.currentTimeMillis();
        JSONArray kept = new JSONArray();
        for (Alarm alarm : alarms) {
            if (alarm.at <= now) continue;
            manager.setAlarmClock(new AlarmManager.AlarmClockInfo(alarm.at, openAppIntent(context)), fireIntent(context, alarm));
            kept.put(alarm.toJson());
        }
        prefs(context).edit().putString(SCHEDULED, kept.toString()).apply();
    }

    // After a reboot Android has forgotten the alarms; set the stored ones again
    static void rearm(Context context) throws JSONException {
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
