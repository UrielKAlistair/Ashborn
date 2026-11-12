package dev.ashborn.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// What the phone's background did, for Settings: each refresh wake (RefreshWake) and each push
// (PushService), newest last, the last KEPT of them. It answers whether wakes reach the network in
// Doze, how late pushes arrive, and whether FCM lowered their priority.
final class Diagnostics {
    private static final String PREFS = "ashborn-diagnostics";
    private static final String ENTRIES = "entries";
    static final int KEPT = 60;

    private Diagnostics() {}

    // A refresh wake at `at`: whether the phone was in Doze and exempt from battery optimisation, and
    // what came of it ("refreshed", "busy", "skipped: ..." or "failed: ...")
    static void wake(Context context, long at, boolean idle, boolean exempt, String outcome) {
        try {
            add(context, new JSONObject().put("type", "wake").put("at", at).put("idle", idle).put("exempt", exempt).put("outcome", outcome));
        } catch (JSONException e) {
            Log.e("Ashborn", "Could not log the wake", e);
        }
    }

    // A push of `kind` sent at `sentAt` (0 if the message had none) and received at `at`, with the
    // priority FCM was asked for and the one it delivered at, and what came of it
    static void push(Context context, long at, String kind, long sentAt, String originalPriority, String priority, String outcome) {
        try {
            add(context, new JSONObject().put("type", "push").put("at", at).put("kind", kind).put("sentAt", sentAt)
                .put("originalPriority", originalPriority).put("priority", priority).put("outcome", outcome));
        } catch (JSONException e) {
            Log.e("Ashborn", "Could not log the push", e);
        }
    }

    static JSONArray entries(Context context) throws JSONException {
        return new JSONArray(prefs(context).getString(ENTRIES, "[]"));
    }

    // `entries` with `entry` added, cut to the last KEPT
    static JSONArray appended(JSONArray entries, JSONObject entry) throws JSONException {
        JSONArray result = new JSONArray();
        int first = Math.max(0, entries.length() + 1 - KEPT);
        for (int i = first; i < entries.length(); i++) result.put(entries.get(i));
        result.put(entry);
        return result;
    }

    private static synchronized void add(Context context, JSONObject entry) throws JSONException {
        prefs(context).edit().putString(ENTRIES, appended(entries(context), entry).toString()).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
