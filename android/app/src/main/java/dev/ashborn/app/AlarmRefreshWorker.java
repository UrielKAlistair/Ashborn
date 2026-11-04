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
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Refills the phone's alarm clock every hour while the app is closed, so a change made on the
// desktop or by the agent reaches the alarms: reads the rows the schedule needs from Supabase,
// computes the next week's alarms (Schedule) and hands them to AlarmScheduler. It signs in with a
// session of its own, made by the app at sign-in, because Supabase refresh tokens are single-use
// and sharing the app's would sign the app out.
public class AlarmRefreshWorker extends Worker {
    private static final String NAME = "alarm-refresh";
    private static final String PREFS = "ashborn-refresh";
    private static final String URL_KEY = "url";
    private static final String PUBLISHABLE_KEY = "publishableKey";
    private static final String REFRESH_TOKEN = "refreshToken";
    // As SCHEDULE_DAYS in src/lib/alarms.ts, RING_LOOKBACK_MS in src/shared/schedule.ts and DEFAULT_DAY_START_HOUR in src/shared/dates.ts
    private static final int SCHEDULE_DAYS = 7;
    private static final long RING_LOOKBACK_MS = 24 * 60 * 60_000L;
    private static final int DEFAULT_DAY_START_HOUR = 4;
    private static final int TIMEOUT_MS = 15_000;

    public AlarmRefreshWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // Keeps the session the app made for the worker, and starts the hourly refresh
    static void connect(Context context, String url, String publishableKey, String refreshToken) {
        prefs(context).edit().putString(URL_KEY, url).putString(PUBLISHABLE_KEY, publishableKey).putString(REFRESH_TOKEN, refreshToken).commit();
        Constraints online = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest hourly = new PeriodicWorkRequest.Builder(AlarmRefreshWorker.class, 1, TimeUnit.HOURS).setConstraints(online).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, hourly);
    }

    static boolean connected(Context context) {
        return prefs(context).getString(REFRESH_TOKEN, null) != null;
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = prefs(context);
        String url = prefs.getString(URL_KEY, null), key = prefs.getString(PUBLISHABLE_KEY, null), token = prefs.getString(REFRESH_TOKEN, null);
        if (token == null) return Result.success();

        try {
            JSONObject session;
            try {
                session = new JSONObject(request(url + "/auth/v1/token?grant_type=refresh_token", key, null, new JSONObject().put("refresh_token", token).toString()));
            } catch (HttpError e) {
                if (e.status >= 500) throw e;
                // The session was revoked or its token already spent: the app's Alarms page asks
                // for the password again
                Log.e("Ashborn", "Background session rejected", e);
                prefs.edit().remove(REFRESH_TOKEN).commit();
                return Result.success();
            }
            // The old token is spent the moment the server answers, so the new one is stored first
            prefs.edit().putString(REFRESH_TOKEN, session.getString("refresh_token")).commit();
            long from = System.currentTimeMillis() - RING_LOOKBACK_MS;
            JSONObject snapshot = read(url + "/rest/v1/", key, session.getString("access_token"), from);
            AlarmScheduler.schedule(context, Schedule.upcoming(snapshot, from, SCHEDULE_DAYS + 1));
            return Result.success();
        } catch (IOException | JSONException | RuntimeException e) {
            Log.e("Ashborn", "Background alarm refresh failed", e);
            return Result.retry();
        }
    }

    // The snapshot's fields that Schedule reads from `from` on, from the same rows the app's getSnapshot reads
    private static JSONObject read(String rest, String key, String access, long from) throws IOException, JSONException {
        JSONArray settings = get(rest, key, access, "user_settings?select=day_start_hour");
        int dayStartHour = settings.length() > 0 ? settings.getJSONObject(0).getInt("day_start_hour") : DEFAULT_DAY_START_HOUR;
        String firstDay = Schedule.dayOf(from, dayStartHour);
        String today = Schedule.dayOf(from, 0);

        JSONArray recipes = get(rest, key, access, "recipes?select=id,title,recipe_reminders(id,label,offsetMinutes:offset_minutes,anchorId:anchor_id)&order=created_at&recipe_reminders.order=position");
        for (int i = 0; i < recipes.length(); i++) {
            JSONObject recipe = recipes.getJSONObject(i);
            recipe.put("reminders", recipe.remove("recipe_reminders"));
        }
        JSONArray defaultWeek = get(rest, key, access, "default_meals?select=weekday,slot,default_meal_recipes(recipe_id)");
        for (int i = 0; i < defaultWeek.length(); i++) recipeIds(defaultWeek.getJSONObject(i), "default_meal_recipes");
        JSONArray meals = get(rest, key, access, "meals?select=date,slot,status,meal_recipes(recipe_id)&date=gte." + Schedule.addDays(today, -1) + "&date=lte." + Schedule.addDays(today, SCHEDULE_DAYS));
        for (int i = 0; i < meals.length(); i++) recipeIds(meals.getJSONObject(i), "meal_recipes");

        return new JSONObject()
            .put("settings", new JSONObject().put("dayStartHour", dayStartHour))
            .put("routines", get(rest, key, access, "routines?select=id,title,weekdays,time,alarm&order=created_at"))
            .put("routineChecks", get(rest, key, access, "routine_checks?select=routineId:routine_id,date&checked=is.true&date=gte." + firstDay))
            .put("skippedAlarms", get(rest, key, access, "alarm_skips?select=key,date&skipped=is.true&date=gte." + Schedule.addDays(today, -1)))
            .put("alarms", get(rest, key, access, "alarms?select=id,label,kind,at,time,weekdays,enabled&or=(at.is.null,at.gt." + utc(from) + ")&order=created_at"))
            .put("deadlines", get(rest, key, access, "deadlines?select=id,title,dueDate:due_date,alarmTime:alarm_time&done_at=is.null&order=due_date"))
            .put("kitchen", new JSONObject().put("recipes", recipes).put("defaultWeek", defaultWeek).put("meals", meals));
    }

    // Replaces a meal's embedded link rows with the plain list of recipe ids the schedule reads
    private static void recipeIds(JSONObject meal, String links) throws JSONException {
        JSONArray rows = (JSONArray) meal.remove(links);
        JSONArray ids = new JSONArray();
        for (int i = 0; i < rows.length(); i++) ids.put(rows.getJSONObject(i).getString("recipe_id"));
        meal.put("recipeIds", ids);
    }

    private static JSONArray get(String rest, String key, String access, String query) throws IOException, JSONException {
        return new JSONArray(request(rest + query, key, access, null));
    }

    // A GET, or a POST of `body`
    private static String request(String url, String key, String access, String body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("apikey", key);
            if (access != null) connection.setRequestProperty("Authorization", "Bearer " + access);
            if (body != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
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
