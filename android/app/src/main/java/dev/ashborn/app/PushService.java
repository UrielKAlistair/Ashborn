package dev.ashborn.app;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.IOException;
import java.util.Map;
import org.json.JSONException;

// Takes the server's pushes (supabase/functions/push), so a change reaches the phone's alarms within
// seconds rather than at the next refresh wake. Two kinds, all values strings, times in epoch ms:
//   {kind: "refresh", sent_at}: run the background refresh;
//   {kind: "call", id, at, label, sent_at}: an agent calling the user. The call is armed at once, before
//   any network, under the key the schedule gives that alarm row, then the refresh runs.
// Each push is logged (Diagnostics) with its delay and the priority FCM delivered it at.
public class PushService extends FirebaseMessagingService {
    // As RefreshWake: onMessageReceived has a few seconds, and the refresh gives up before then
    private static final long RUN_MS = 8_000;

    // Asks Firebase for the phone's token, for the background refresh to register. Without the app's
    // Firebase config (android/app/google-services.json) there is none, and pushes stay off.
    static void fetchToken(Context context) {
        Context app = context.getApplicationContext();
        try {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> AlarmRefreshWorker.setPushToken(app, token));
        } catch (IllegalStateException e) {
            Log.w("Ashborn", "Pushes off: Firebase is not configured in this build", e);
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        AlarmRefreshWorker.setPushToken(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        long received = System.currentTimeMillis();
        Map<String, String> data = message.getData();
        String kind = data.get("kind");
        String outcome;
        try {
            if ("call".equals(kind)) arm(data, received);
            outcome = refresh(received);
        } catch (IOException | JSONException | RuntimeException e) {
            Log.e("Ashborn", "Push handling failed", e);
            outcome = "failed: " + e.getMessage();
        }
        Diagnostics.push(this, received, String.valueOf(kind), parseLong(data.get("sent_at")),
            priorityName(message.getOriginalPriority()), priorityName(message.getPriority()), outcome);
    }

    // Arms the call in the push; one already too late is reported missed instead
    private void arm(Map<String, String> data, long now) throws JSONException {
        String label = data.get("label");
        long at = Long.parseLong(data.get("at"));
        Alarm call = new Alarm("alarm:" + data.get("id") + "@" + at, at, label == null || label.isEmpty() ? "Alarm" : label, "plain", Alarm.CALL);
        if (AlarmService.staleCall(call, now)) AlarmService.notifyMissed(this, call);
        else AlarmScheduler.push(this, call);
    }

    // Runs the background refresh, as RefreshWake does: not near a ring, whose process it could take down.
    // So a change pushed within RING_NEAR_MS of a ring (a deletion 30 s before it, say) waits for the next wake.
    private String refresh(long now) throws IOException, JSONException {
        if (RefreshWake.ringNear(AlarmService.ringing, AlarmReceiver.firedAt, RefreshWake.nextRingAt(this), now)) return "skipped: ring near";
        return AlarmRefreshWorker.refresh(this, now + RUN_MS) ? "refreshed" : "busy or not connected";
    }

    private static String priorityName(int priority) {
        return priority == RemoteMessage.PRIORITY_HIGH ? "high" : priority == RemoteMessage.PRIORITY_NORMAL ? "normal" : "unknown";
    }

    private static long parseLong(String text) {
        try {
            return text == null ? 0 : Long.parseLong(text);
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
