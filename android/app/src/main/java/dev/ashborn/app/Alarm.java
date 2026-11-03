package dev.ashborn.app;

import org.json.JSONException;
import org.json.JSONObject;

// One ring of an alarm, as the web app computes it (src/shared/schedule.ts)
final class Alarm {
    final String key; // stable per source and ring: its day, or a one-off's moment
    final long at; // epoch milliseconds
    final String title;
    final String kind; // "plain", "walk" or "situps"

    Alarm(String key, long at, String title, String kind) {
        this.key = key;
        this.at = at;
        this.title = title;
        this.kind = kind;
    }

    static Alarm fromJson(JSONObject json) throws JSONException {
        return new Alarm(json.getString("key"), json.getLong("at"), json.getString("title"), json.getString("kind"));
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject().put("key", key).put("at", at).put("title", title).put("kind", kind);
    }
}
