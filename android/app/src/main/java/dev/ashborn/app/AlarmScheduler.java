package dev.ashborn.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

// Keeps Android's alarm clock in step with the app: the scheduled alarms and the rings going off
// now are stored on the phone, so they survive the app closing and are re-armed after a reboot.
// The app and the background refresh both schedule, so scheduling is synchronized. A call pushed to
// the phone (PushService) is held apart from the schedule until it rings, so a schedule built from
// rows read before the call existed does not drop it.
final class AlarmScheduler {
    private static final String PREFS = "ashborn-alarms";
    private static final String SCHEDULED = "scheduled";
    private static final String RINGING = "ringing";
    private static final String SNOOZED = "snoozed";
    private static final String SNOOZE_PREFIX = "snooze:";
    private static final String PUSHED = "pushed";
    private static final String PUSHED_AT = "pushedAt";
    private static final String HANDED_AT_PREFIX = "handedAt:";
    private static final long SNOOZE_MS = 10 * 60_000;

    static final String EXTRA_ALARM = "alarm";

    private AlarmScheduler() {}

    // Replaces every scheduled alarm with `alarms`, built from rows read at `readAt` (epoch ms), plus
    // the snoozed alarms still to ring, which the app's schedule does not know about, and the pushed
    // calls still to ring (stillPushed). `alarms` reaches a day back (RING_LOOKBACK_MS in
    // src/shared/schedule.ts), so it also holds the rings already rung that are still due; it is stored
    // whole, for snoozing and re-arming after a reboot.
    static synchronized void schedule(Context context, List<Alarm> alarms, long readAt) throws JSONException {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        long now = System.currentTimeMillis();
        List<Alarm> snoozed = load(context, SNOOZED);
        List<Pushed> pushed = loadPushed(context);
        Map<String, Alarm> byKey = new LinkedHashMap<>();
        JSONArray scheduled = new JSONArray();
        for (Alarm alarm : alarms) {
            byKey.put(alarm.key, alarm);
            scheduled.put(alarm.toJson());
        }
        JSONArray stillSnoozed = new JSONArray();
        for (Alarm alarm : stillSnoozed(snoozed, byKey.keySet(), now)) {
            byKey.put(alarm.key, alarm);
            stillSnoozed.put(alarm.toJson());
        }
        // After the schedule, so a pushed call due now (rung at once) replaces its past ring of the same key
        JSONArray stillPushed = new JSONArray();
        for (Pushed call : stillPushed(pushed, byKey.keySet(), readAt, now)) {
            byKey.put(call.alarm.key, call.alarm);
            stillPushed.put(call.toJson());
        }

        // Setting a key again replaces its alarm (one PendingIntent per key), so only the alarms
        // that leave are cancelled: cancelling all first would drop a ring falling due meanwhile
        List<Alarm> before = load(context, SCHEDULED);
        before.addAll(snoozed);
        for (Pushed call : pushed) before.add(call.alarm);
        for (Alarm old : before) {
            if (leaves(old, byKey.get(old.key), now)) manager.cancel(fireIntent(context, old));
        }

        // Stored first, and each alarm set on its own, so one the system refuses (exact alarms not
        // allowed) neither loses the schedule nor stops the alarms after it from being set
        prefs(context).edit().putString(SCHEDULED, scheduled.toString()).putString(SNOOZED, stillSnoozed.toString()).putString(PUSHED, stillPushed.toString()).apply();
        for (Alarm alarm : byKey.values()) {
            if (alarm.at <= now) continue;
            try {
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(alarm.at, openAppIntent(context)), fireIntent(context, alarm));
            } catch (RuntimeException e) {
                // Not replaced, an earlier time set before would still ring
                manager.cancel(fireIntent(context, alarm));
                Log.e("Ashborn", "Could not set the alarm " + alarm.key, e);
            }
        }
    }

    // Whether a set alarm must be cancelled when `next` (null if gone) replaces it: it is gone, or moved
    // to a time already past, which is not set again; one moved to a later time is replaced by setting it
    static boolean leaves(Alarm old, Alarm next, long now) {
        return next == null || (next.at <= now && next.at != old.at);
    }

    // Schedules `alarms`, built from rows read at `readAt`, as handed over by `by` ("app" or
    // "background"), and records when
    static synchronized void handOver(Context context, List<Alarm> alarms, String by, long readAt) throws JSONException {
        schedule(context, alarms, readAt);
        prefs(context).edit().putLong(HANDED_AT_PREFIX + by, System.currentTimeMillis()).apply();
    }

    // When `by` last handed the schedule over, in epoch milliseconds; 0 if it never has
    static long handedAt(Context context, String by) {
        return prefs(context).getLong(HANDED_AT_PREFIX + by, 0);
    }

    // Arms a call pushed to the phone at once, ahead of any refresh; one already due rings now
    static synchronized void push(Context context, Alarm call) throws JSONException {
        long now = System.currentTimeMillis();
        Alarm armed = call.at > now ? call : new Alarm(call.key, now + 1000, call.title, call.kind, call.sound);
        List<Pushed> pushed = new ArrayList<>();
        for (Pushed other : loadPushed(context)) if (!other.alarm.key.equals(call.key)) pushed.add(other);
        pushed.add(new Pushed(armed, now));
        JSONArray array = new JSONArray();
        for (Pushed one : pushed) array.put(one.toJson());
        prefs(context).edit().putString(PUSHED, array.toString()).apply();
        schedule(context, load(context, SCHEDULED), 0);
    }

    // The pushed calls kept: those still to ring that the new schedule has too, or that arrived after
    // its rows were read (a call missing from rows read later was deleted)
    static List<Pushed> stillPushed(List<Pushed> pushed, Set<String> scheduled, long readAt, long now) {
        List<Pushed> kept = new ArrayList<>();
        for (Pushed call : pushed) {
            if (call.alarm.at > now && (scheduled.contains(call.alarm.key) || call.pushedAt > readAt)) kept.add(call);
        }
        return kept;
    }

    // The next `count` alarms still to ring, snoozes and pushed calls included, soonest first
    static List<Alarm> next(Context context, int count) throws JSONException {
        List<Alarm> extra = load(context, SNOOZED);
        for (Pushed call : loadPushed(context)) extra.add(call.alarm);
        return next(load(context, SCHEDULED), extra, System.currentTimeMillis(), count);
    }

    static List<Alarm> next(List<Alarm> scheduled, List<Alarm> snoozed, long now, int count) {
        List<Alarm> due = new ArrayList<>();
        for (Alarm alarm : scheduled) if (alarm.at > now) due.add(alarm);
        for (Alarm alarm : snoozed) if (alarm.at > now) due.add(alarm);
        due.sort((a, b) -> Long.compare(a.at, b.at));
        return new ArrayList<>(due.subList(0, Math.min(count, due.size())));
    }

    // The snoozes still to ring: those due later whose ring is still in the schedule, so one whose
    // ring was ticked, skipped or removed since stops coming back
    static List<Alarm> stillSnoozed(List<Alarm> snoozed, Set<String> scheduled, long now) {
        List<Alarm> kept = new ArrayList<>();
        for (Alarm alarm : snoozed) {
            if (alarm.at > now && scheduled.contains(alarm.key.substring(SNOOZE_PREFIX.length()))) kept.add(alarm);
        }
        return kept;
    }

    // After a reboot Android has forgotten the alarms; set the stored ones again
    static synchronized void rearm(Context context) throws JSONException {
        schedule(context, load(context, SCHEDULED), 0);
    }

    // Rings `parts` again in ten minutes, each under its own key, so they go off together again
    static synchronized void snooze(Context context, List<Alarm> parts) throws JSONException {
        JSONArray array = new JSONArray();
        for (Alarm alarm : snoozedWith(load(context, SNOOZED), parts, System.currentTimeMillis() + SNOOZE_MS)) array.put(alarm.toJson());
        prefs(context).edit().putString(SNOOZED, array.toString()).apply();
        schedule(context, load(context, SCHEDULED), 0);
    }

    // `snoozed` with each of `parts` due again at `at`; snoozing a snoozed ring moves it rather than adding one
    static List<Alarm> snoozedWith(List<Alarm> snoozed, List<Alarm> parts, long at) {
        Set<String> keys = new HashSet<>();
        List<Alarm> added = new ArrayList<>();
        for (Alarm part : parts) {
            String key = part.key.startsWith(SNOOZE_PREFIX) ? part.key : SNOOZE_PREFIX + part.key;
            keys.add(key);
            added.add(new Alarm(key, at, part.title, part.kind, part.sound));
        }
        List<Alarm> result = new ArrayList<>();
        for (Alarm other : snoozed) if (!keys.contains(other.key)) result.add(other);
        result.addAll(added);
        return result;
    }

    // The rings going off now, for the app; none clears them
    static void setRinging(Context context, List<Alarm> parts) throws JSONException {
        JSONArray array = new JSONArray();
        for (Alarm part : parts) array.put(part.toJson());
        SharedPreferences.Editor editor = prefs(context).edit();
        if (parts.isEmpty()) editor.remove(RINGING);
        else editor.putString(RINGING, array.toString());
        editor.apply();
    }

    // The rings going off now, joined into one; null when none is
    static Alarm ringing(Context context) {
        List<Alarm> parts = ringingParts(context);
        return parts.isEmpty() ? null : Alarm.joined(parts);
    }

    static List<Alarm> ringingParts(Context context) {
        try {
            return load(context, RINGING);
        } catch (JSONException e) {
            return new ArrayList<>();
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

    private static List<Pushed> loadPushed(Context context) throws JSONException {
        JSONArray array = new JSONArray(prefs(context).getString(PUSHED, "[]"));
        List<Pushed> pushed = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject json = array.getJSONObject(i);
            pushed.add(new Pushed(Alarm.fromJson(json), json.getLong(PUSHED_AT)));
        }
        return pushed;
    }

    // A call pushed to the phone, and when it arrived (epoch ms)
    static final class Pushed {
        final Alarm alarm;
        final long pushedAt;

        Pushed(Alarm alarm, long pushedAt) {
            this.alarm = alarm;
            this.pushedAt = pushedAt;
        }

        JSONObject toJson() throws JSONException {
            return alarm.toJson().put(PUSHED_AT, pushedAt);
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
