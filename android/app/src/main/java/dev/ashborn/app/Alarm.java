package dev.ashborn.app;

import java.util.Arrays;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

// One ring of an alarm, as the web app computes it (src/shared/schedule.ts)
final class Alarm {
    // The stops, easiest first; rings joined take the hardest of theirs
    private static final List<String> STOPS = Arrays.asList("plain", "walk", "situps");
    // How many titles joined rings name before "+ N more"
    private static final int TITLES_SHOWN = 3;

    final String key; // stable per source and ring: its day, or a one-off's moment
    final long at; // epoch milliseconds
    final String title;
    final String kind; // "plain", "walk" or "situps"
    final String sound; // DEFAULT, or CALL for an agent calling the user

    static final String DEFAULT = "default";
    static final String CALL = "call";

    Alarm(String key, long at, String title, String kind, String sound) {
        this.key = key;
        this.at = at;
        this.title = title;
        this.kind = kind;
        this.sound = sound;
    }

    Alarm(String key, long at, String title, String kind) {
        this(key, at, title, kind, DEFAULT);
    }

    boolean isCall() {
        return CALL.equals(sound);
    }

    // Rings going off together, as one: the first's key and time, their titles, the hardest stop, and
    // the call's sound if any part is a call
    static Alarm joined(List<Alarm> parts) {
        Alarm first = parts.get(0);
        String kind = first.kind;
        String sound = DEFAULT;
        StringBuilder title = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            Alarm part = parts.get(i);
            if (STOPS.indexOf(part.kind) > STOPS.indexOf(kind)) kind = part.kind;
            if (part.isCall()) sound = CALL;
            if (i < TITLES_SHOWN) title.append(i == 0 ? "" : " + ").append(part.title);
        }
        if (parts.size() > TITLES_SHOWN) title.append(" + ").append(parts.size() - TITLES_SHOWN).append(" more");
        return new Alarm(first.key, first.at, title.toString(), kind, sound);
    }

    // Whether a stop or snooze given for the ring shown as `shownKey` with `shownKind` may end `parts`:
    // not when a different ring is going (the shown one ended and another began before the screen
    // caught up), nor when a harder stop has joined since the user saw it
    static boolean stopAllowed(String shownKey, String shownKind, List<Alarm> parts) {
        if (parts.isEmpty()) return true;
        Alarm ringing = joined(parts);
        return ringing.key.equals(shownKey) && STOPS.indexOf(shownKind) >= STOPS.indexOf(ringing.kind);
    }

    static Alarm fromJson(JSONObject json) throws JSONException {
        // Rings stored before calls existed have no sound
        return new Alarm(json.getString("key"), json.getLong("at"), json.getString("title"), json.getString("kind"), json.optString("sound", DEFAULT));
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject().put("key", key).put("at", at).put("title", title).put("kind", kind).put("sound", sound);
    }
}
