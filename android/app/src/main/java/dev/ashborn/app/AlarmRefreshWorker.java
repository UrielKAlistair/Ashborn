package dev.ashborn.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Scanner;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Refills the phone's alarm clock while the app is closed, so a change made on the desktop or by
// the agent reaches the alarms: reads the rows the schedule needs from Supabase, computes the next
// week's alarms (Schedule) and hands them to AlarmScheduler. It runs from an exact wake every 15
// minutes (RefreshWake), which Doze lets through (though in Doze it reaches the network only with the
// battery exemption), and from this hourly job, which Doze defers, as a fallback for when exact
// alarms are refused, and on each push (PushService). It signs in with a session of its own, made by the app
// at sign-in, because Supabase refresh tokens are single-use and sharing the app's would sign the app out.
// With that session it also registers the phone's push token (push_devices), once per token and session.
public class AlarmRefreshWorker extends Worker {
    private static final String NAME = "alarm-refresh";
    private static final String PREFS = "ashborn-refresh";
    private static final String URL_KEY = "url";
    private static final String PUBLISHABLE_KEY = "publishableKey";
    private static final String REFRESH_TOKEN = "refreshToken";
    // The session's access token and when it expires (epoch ms), reused across runs so the
    // single-use refresh token is spent about once an hour, not on every wake
    private static final String ACCESS_TOKEN = "accessToken";
    private static final String ACCESS_EXPIRES = "accessExpires";
    // The phone's FCM token, and whether this session has registered it
    private static final String PUSH_TOKEN = "pushToken";
    private static final String PUSH_TOKEN_SENT = "pushTokenSent";
    // An access token this near its expiry is renewed first, so it can't lapse mid-refresh
    static final long RENEW_BEFORE_MS = 5 * 60_000L;
    // As SCHEDULE_DAYS in src/lib/alarms.ts, RING_LOOKBACK_MS in src/shared/schedule.ts and DEFAULT_DAY_START_HOUR in src/shared/dates.ts
    private static final int SCHEDULE_DAYS = 7;
    private static final long RING_LOOKBACK_MS = 24 * 60 * 60_000L;
    private static final int DEFAULT_DAY_START_HOUR = 4;
    private static final int TIMEOUT_MS = 15_000;
    // The least a retried renewal is given to answer
    private static final int RETRY_MIN_MS = 1500;
    // One refresh at a time: two would spend the same single-use token, and the loser's rejection
    // would disconnect the refresh
    private static final ReentrantLock running = new ReentrantLock();
    // A refresh asked for while one runs: the running one reads again after, or a push's change
    // that landed mid-read would wait for the next wake
    private static final AtomicBoolean wanted = new AtomicBoolean(false);

    public AlarmRefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // Keeps the session the app made for the worker, and starts the wakes and the hourly refresh
    static void connect(Context context, String url, String publishableKey, String refreshToken) {
        prefs(context).edit().putString(URL_KEY, url).putString(PUBLISHABLE_KEY, publishableKey).putString(REFRESH_TOKEN, refreshToken).remove(ACCESS_TOKEN).putBoolean(PUSH_TOKEN_SENT, false).commit();
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest hourly = new PeriodicWorkRequest.Builder(AlarmRefreshWorker.class, 1, TimeUnit.HOURS).setConstraints(online).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, hourly);
        RefreshWake.arm(context);
        PushService.fetchToken(context);
    }

    // Keeps the phone's push token and registers it with a refresh at once, off the calling thread
    // (Firebase calls back on the main one); a failure leaves it for the next wake
    static void setPushToken(Context context, String token) {
        SharedPreferences prefs = prefs(context);
        if (token.equals(prefs.getString(PUSH_TOKEN, null)) && prefs.getBoolean(PUSH_TOKEN_SENT, false)) return;
        prefs.edit().putString(PUSH_TOKEN, token).putBoolean(PUSH_TOKEN_SENT, false).commit();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                refresh(app, System.currentTimeMillis() + TIMEOUT_MS);
            } catch (IOException | JSONException | RuntimeException e) {
                Log.e("Ashborn", "Refresh to register the push token failed", e);
            }
        }).start();
    }

    static boolean connected(Context context) {
        return prefs(context).getString(REFRESH_TOKEN, null) != null;
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        // Restarts the wakes if their chain broke (a refused exact alarm, a run that died)
        RefreshWake.arm(context);
        try {
            refresh(context, Long.MAX_VALUE);
            return Result.success();
        } catch (IOException | JSONException | RuntimeException e) {
            Log.e("Ashborn", "Background alarm refresh failed", e);
            return Result.retry();
        }
    }

    // Reads the schedule and hands it over, giving up at `deadline` (epoch ms). Asked while another
    // refresh runs, it returns false at once and that one reads again when done. Returns false without
    // refreshing when the background is not connected. Throws when the refresh should be tried again later.
    static boolean refresh(Context context, long deadline) throws IOException, JSONException {
        wanted.set(true);
        boolean refreshed = false;
        // The outer loop catches an ask that arrived after the inner loop's last check but before unlocking
        while (wanted.get() && System.currentTimeMillis() < deadline) {
            if (!running.tryLock()) return false;
            try {
                while (System.currentTimeMillis() < deadline && wanted.getAndSet(false)) refreshed = refreshOnce(context, deadline);
            } finally {
                running.unlock();
            }
        }
        return refreshed;
    }

    private static boolean refreshOnce(Context context, long deadline) throws IOException, JSONException {
        SharedPreferences prefs = prefs(context);
        String url = prefs.getString(URL_KEY, null), key = prefs.getString(PUBLISHABLE_KEY, null);
        String access = access(prefs, url, key, deadline);
        if (access == null) return false;
        long started = System.currentTimeMillis();
        long from = started - RING_LOOKBACK_MS;
        JSONObject snapshot;
        try {
            snapshot = read(url + "/rest/v1/", key, access, from, deadline);
        } catch (HttpError e) {
            // An access token refused (its session ended) is renewed on the next run
            if (e.status == 401) prefs.edit().remove(ACCESS_TOKEN).commit();
            throw e;
        }
        // The app handing its schedule over while this read ran handed over newer data (its own
        // changes not yet sent included), which this read must not replace
        synchronized (AlarmScheduler.class) {
            if (AlarmScheduler.handedAt(context, "app") < started) {
                AlarmScheduler.handOver(context, Schedule.upcoming(snapshot, from, SCHEDULE_DAYS + 1), "background", started);
            }
        }
        registerPushToken(prefs, url, key, access, deadline);
        return true;
    }

    // The session's access token, renewed first if near its expiry; null when the background is not
    // connected or its session was refused. Called only under `running`: renewing spends the single-use refresh token.
    private static String access(SharedPreferences prefs, String url, String key, long deadline) throws IOException, JSONException {
        String token = prefs.getString(REFRESH_TOKEN, null);
        if (token == null) return null;
        String access = prefs.getString(ACCESS_TOKEN, null);
        if (access != null && !needsRenewing(prefs.getLong(ACCESS_EXPIRES, 0), System.currentTimeMillis())) return access;
        JSONObject session;
        try {
            session = new JSONObject(renew(url, key, token, deadline));
        } catch (HttpError e) {
            // A busy or slow server (overloaded, rate-limited, timed out) is tried again later
            if (e.status >= 500 || e.status == 429 || e.status == 408) throw e;
            // The session was revoked or its token already spent: the app's Settings asks
            // for the password again
            Log.e("Ashborn", "Background session rejected", e);
            prefs.edit().remove(REFRESH_TOKEN).remove(ACCESS_TOKEN).commit();
            return null;
        }
        // The old token is spent the moment the server answers, so the new one is stored first
        access = session.getString("access_token");
        prefs.edit()
            .putString(REFRESH_TOKEN, session.getString("refresh_token"))
            .putString(ACCESS_TOKEN, access)
            .putLong(ACCESS_EXPIRES, session.optLong("expires_at", 0) * 1000)
            .commit();
        return access;
    }

    // Registers the phone's push token for this session's user, if not yet done. A failure leaves it
    // for the next refresh and does not stop this one.
    private static void registerPushToken(SharedPreferences prefs, String url, String key, String access, long deadline) {
        String token = prefs.getString(PUSH_TOKEN, null);
        if (token == null || prefs.getBoolean(PUSH_TOKEN_SENT, false)) return;
        try {
            String body = new JSONObject().put("token", token).put("updated_at", utc(System.currentTimeMillis())).toString();
            request(url + "/rest/v1/push_devices?on_conflict=token", key, access, body, "resolution=merge-duplicates", deadline);
            prefs.edit().putBoolean(PUSH_TOKEN_SENT, true).commit();
        } catch (IOException | JSONException e) {
            Log.e("Ashborn", "Could not register the push token", e);
        }
    }

    // The snapshot's fields that Schedule reads from `from` on, from the same rows the app's getSnapshot reads
    private static JSONObject read(String rest, String key, String access, long from, long deadline) throws IOException, JSONException {
        JSONArray settings = get(rest, key, access, deadline, "user_settings?select=day_start_hour");
        int dayStartHour = settings.length() > 0 ? settings.getJSONObject(0).getInt("day_start_hour") : DEFAULT_DAY_START_HOUR;
        String firstDay = Schedule.dayOf(from, dayStartHour);
        String today = Schedule.dayOf(from, 0);

        JSONArray recipes = get(rest, key, access, deadline, "recipes?select=id,title,recipe_reminders(id,label,offsetMinutes:offset_minutes,anchorId:anchor_id)&order=created_at&recipe_reminders.order=position");
        for (int i = 0; i < recipes.length(); i++) {
            JSONObject recipe = recipes.getJSONObject(i);
            recipe.put("reminders", recipe.remove("recipe_reminders"));
        }
        JSONArray defaultWeek = get(rest, key, access, deadline, "default_meals?select=weekday,slot,default_meal_recipes(recipe_id)");
        for (int i = 0; i < defaultWeek.length(); i++) recipeIds(defaultWeek.getJSONObject(i), "default_meal_recipes");
        JSONArray meals = get(rest, key, access, deadline, "meals?select=date,slot,status,meal_recipes(recipe_id)&date=gte." + Schedule.addDays(today, -1) + "&date=lte." + Schedule.addDays(today, SCHEDULE_DAYS));
        for (int i = 0; i < meals.length(); i++) recipeIds(meals.getJSONObject(i), "meal_recipes");

        return new JSONObject()
            .put("settings", new JSONObject().put("dayStartHour", dayStartHour))
            .put("routines", get(rest, key, access, deadline, "routines?select=id,title,weekdays,time,alarm&order=created_at"))
            .put("routineChecks", get(rest, key, access, deadline, "routine_checks?select=routineId:routine_id,date&checked=is.true&date=gte." + firstDay))
            .put("skippedAlarms", get(rest, key, access, deadline, "alarm_skips?select=key,date&skipped=is.true&date=gte." + Schedule.addDays(today, -1)))
            .put("alarms", get(rest, key, access, deadline, "alarms?select=id,label,kind,sound,at,time,weekdays,enabled&or=(at.is.null,at.gt." + utc(from) + ")&order=created_at"))
            .put("deadlines", get(rest, key, access, deadline, "deadlines?select=id,title,dueDate:due_date,alarmTime:alarm_time&done_at=is.null&order=due_date"))
            .put("kitchen", new JSONObject().put("recipes", recipes).put("defaultWeek", defaultWeek).put("meals", meals));
    }

    // Replaces a meal's embedded link rows with the plain list of recipe ids the schedule reads
    private static void recipeIds(JSONObject meal, String links) throws JSONException {
        JSONArray rows = (JSONArray) meal.remove(links);
        JSONArray ids = new JSONArray();
        for (int i = 0; i < rows.length(); i++) ids.put(rows.getJSONObject(i).getString("recipe_id"));
        meal.put("recipeIds", ids);
    }

    private static JSONArray get(String rest, String key, String access, long deadline, String query) throws IOException, JSONException {
        return new JSONArray(request(rest + query, key, access, null, null, deadline));
    }

    // A GET, or a POST of `body` with the Prefer header `prefer` (null for none), abandoned at `deadline`
    private static String request(String url, String key, String access, String body, String prefer, long deadline) throws IOException {
        int timeout = timeout(deadline, System.currentTimeMillis());
        if (timeout <= 0) throw new IOException("Out of time before " + url.replaceFirst("\\?.*", ""));
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(timeout);
            connection.setReadTimeout(timeout);
            connection.setRequestProperty("apikey", key);
            if (access != null) connection.setRequestProperty("Authorization", "Bearer " + access);
            if (body != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                if (prefer != null) connection.setRequestProperty("Prefer", prefer);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            if (status >= 300) throw new HttpError(status, url.replaceFirst("\\?.*", "") + ": " + text(connection.getErrorStream()));
            return text(connection.getInputStream());
        } finally {
            connection.disconnect();
        }
    }

    // A renewal whose answer is lost on the way has still spent the token. Supabase Auth takes a spent
    // token again for a few seconds (its reuse interval, 10 s by default; this project's is not read
    // here), so a renewal that fails on the network is tried once more at once; a refusal is not
    private static String renew(String url, String key, String token, long deadline) throws IOException, JSONException {
        String endpoint = url + "/auth/v1/token?grant_type=refresh_token";
        String body = new JSONObject().put("refresh_token", token).toString();
        try {
            return request(endpoint, key, null, body, null, deadline);
        } catch (HttpError e) {
            throw e;
        } catch (IOException e) {
            if (timeout(deadline, System.currentTimeMillis()) < RETRY_MIN_MS) throw e;
            Log.w("Ashborn", "Renewing the background session failed on the network; trying once more", e);
            return request(endpoint, key, null, body, null, deadline);
        }
    }

    // Whether an access token expiring at `expiresAt` (epoch ms; 0 when unknown) is renewed before use
    static boolean needsRenewing(long expiresAt, long now) {
        return expiresAt - now < RENEW_BEFORE_MS;
    }

    // A request's connect and read timeouts, in ms: TIMEOUT_MS, cut to half what is left before
    // `deadline`, since the two follow each other
    static int timeout(long deadline, long now) {
        return (int) Math.max(0, Math.min(TIMEOUT_MS, (deadline - now) / 2));
    }

    private static String text(InputStream in) {
        if (in == null) return "";
        try (Scanner scanner = new Scanner(in, StandardCharsets.UTF_8.name()).useDelimiter("\\A")) {
            return scanner.hasNext() ? scanner.next() : "";
        }
    }

    private static String utc(long moment) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(moment));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static final class HttpError extends IOException {
        final int status;

        HttpError(int status, String message) {
            super(status + " from " + message);
            this.status = status;
        }
    }
}
