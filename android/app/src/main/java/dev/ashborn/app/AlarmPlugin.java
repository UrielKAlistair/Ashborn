package dev.ashborn.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

// The web app's handle on alarms (src/lib/alarms.ts): hand over the schedule, ask which alarm is
// ringing, stop or snooze it, read back what is scheduled, check the permissions alarms need, hand
// over the session the background refresh signs in with, set the notice for the end of Now's timer,
// and keep the screen on
@CapacitorPlugin(name = "AshbornAlarm")
public class AlarmPlugin extends Plugin {
    // How many of the stored alarms `held` reports
    private static final int HELD_SHOWN = 5;

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            JSArray array = call.getArray("alarms", new JSArray());
            List<Alarm> alarms = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) alarms.add(Alarm.fromJson(array.getJSONObject(i)));
            // When the app's rows were read is not known (a pushed call may not have reached them yet), so
            // they never drop a pushed call; only a background refresh, or the call's own time, does
            AlarmScheduler.handOver(getContext(), alarms, "app", 0);
            // Restarts the refresh wakes after a force-stop or an update cancelled them
            RefreshWake.arm(getContext());
            call.resolve();
        } catch (JSONException e) {
            call.reject("Bad alarm list", e);
        }
    }

    @PluginMethod
    public void ringing(PluginCall call) {
        Alarm alarm = AlarmScheduler.ringing(getContext());
        JSObject result = new JSObject();
        try {
            result.put("alarm", alarm == null ? null : JSObject.fromJSONObject(alarm.toJson()));
        } catch (JSONException e) {
            call.reject("Bad ringing alarm", e);
            return;
        }
        call.resolve(result);
    }

    // What the phone holds: the next alarms in the stored schedule, when the app and the background
    // refresh each last handed it over, the next alarm clock Android itself will ring (any app's), with
    // whether it is ours, and the background's log of wakes and pushes (Diagnostics)
    @PluginMethod
    public void held(PluginCall call) {
        JSObject result = new JSObject();
        try {
            JSArray alarms = new JSArray();
            for (Alarm alarm : AlarmScheduler.next(getContext(), HELD_SHOWN)) alarms.put(alarm.toJson());
            result.put("alarms", alarms);
            result.put("log", Diagnostics.entries(getContext()));
        } catch (JSONException e) {
            call.reject("Bad stored schedule", e);
            return;
        }
        for (String by : new String[] {"app", "background"}) {
            long at = AlarmScheduler.handedAt(getContext(), by);
            result.put(by + "HandedAt", at == 0 ? JSONObject.NULL : (Object) at);
        }
        AlarmManager.AlarmClockInfo system = getContext().getSystemService(AlarmManager.class).getNextAlarmClock();
        if (system == null) result.put("system", JSONObject.NULL);
        else {
            PendingIntent show = system.getShowIntent();
            JSObject next = new JSObject();
            next.put("at", system.getTriggerTime());
            next.put("ours", show != null && getContext().getPackageName().equals(show.getCreatorPackage()));
            result.put("system", next);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        end(call, AlarmService.ACTION_STOP);
    }

    @PluginMethod
    public void connectBackground(PluginCall call) {
        String url = call.getString("url"), publishableKey = call.getString("publishableKey"), refreshToken = call.getString("refreshToken");
        if (url == null || publishableKey == null || refreshToken == null) {
            call.reject("url, publishableKey and refreshToken are needed");
            return;
        }
        AlarmRefreshWorker.connect(getContext(), url, publishableKey, refreshToken);
        call.resolve();
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        end(call, AlarmService.ACTION_SNOOZE);
    }

    // Stops or snoozes the ring the screen showed (`key`, `kind`); refused, with `stopped` false, when
    // another ring is going or a harder one has joined it since
    private void end(PluginCall call, String action) {
        String key = call.getString("key");
        String kind = call.getString("kind");
        boolean stopped = Alarm.stopAllowed(key, kind, AlarmScheduler.ringingParts(getContext()));
        if (stopped) {
            getContext().startService(new Intent(getContext(), AlarmService.class).setAction(action).putExtra(AlarmService.EXTRA_SHOWN_KEY, key).putExtra(AlarmService.EXTRA_SHOWN_KIND, kind));
            getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).showOverLockScreen(false));
        }
        JSObject result = new JSObject();
        result.put("stopped", stopped);
        call.resolve(result);
    }

    // Notifications must be allowed for an alarm to show; on Android 14+ showing over the lock
    // screen is a separate switch for apps installed outside the Play Store. Battery optimisation
    // can delay or drop alarms, and Xiaomi's phones also stop apps that lack Autostart (which no
    // app can read, so it is only reported whether the phone is a Xiaomi). Refreshing alarms while
    // the app is closed needs the session the app hands over at sign-in.
    @PluginMethod
    public void permissions(PluginCall call) {
        // Off when the permission is refused (13+) or the app's notifications are switched off (any version)
        boolean notifications = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        boolean fullScreen = Build.VERSION.SDK_INT < 34 || getContext().getSystemService(NotificationManager.class).canUseFullScreenIntent();
        JSObject result = new JSObject();
        result.put("notifications", notifications);
        result.put("fullScreen", fullScreen);
        // Android 12 and 12L let the user take exact alarms away (SCHEDULE_EXACT_ALARM), and then no
        // alarm can be set; from 13 on, USE_EXACT_ALARM is granted for good
        result.put("exactAlarms", Build.VERSION.SDK_INT < 31 || Build.VERSION.SDK_INT >= 33 || getContext().getSystemService(AlarmManager.class).canScheduleExactAlarms());
        PowerManager power = getContext().getSystemService(PowerManager.class);
        result.put("battery", power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        result.put("xiaomi", "xiaomi".equalsIgnoreCase(Build.MANUFACTURER));
        result.put("background", AlarmRefreshWorker.connected(getContext()));
        // The Alarms channel must be of high importance to pop up and to show over the lock screen;
        // some phones (HyperOS) lower a new channel's, or the user may have
        AlarmService.createChannel(getContext());
        NotificationChannel channel = getContext().getSystemService(NotificationManager.class).getNotificationChannel(AlarmService.CHANNEL);
        result.put("alarmChannel", channel != null && channel.getImportance() >= NotificationManager.IMPORTANCE_HIGH);
        call.resolve(result);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
        // Some builds lack the request dialog: the list of apps to exempt instead, or nothing if that is missing too
        if (!open(intent)) open(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        call.resolve();
    }

    // Opens a settings screen; false where the phone has none to answer it
    private boolean open(Intent intent) {
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    // Xiaomi's own Autostart list; on other builds, the app's settings page
    @PluginMethod
    public void openAutostart(PluginCall call) {
        Intent xiaomi = new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
        try {
            getActivity().startActivity(xiaomi);
        } catch (Exception e) {
            getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
        }
        call.resolve();
    }

    // Asks the first time; once refused for good (Android then shows no dialog), opens the app's
    // notification settings instead, so the button always leads somewhere. Android tells "never asked"
    // from "refused for good" only by whether the app has asked before, so that is remembered.
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 33
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            // Allowed, but switched off in the app's notification settings
            open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName()));
        } else {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences("ashborn-permissions", android.content.Context.MODE_PRIVATE);
            boolean asked = prefs.getBoolean("notificationsAsked", false);
            if (asked && !ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.POST_NOTIFICATIONS)) {
                getActivity().startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName()));
            } else {
                prefs.edit().putBoolean("notificationsAsked", true).apply();
                ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
            }
        }
        call.resolve();
    }

    // Keeps the screen on, or lets it sleep again (MainActivity.keepAwake)
    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).keepAwake(on));
        call.resolve();
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())));
        }
        call.resolve();
    }

    @PluginMethod
    public void openAlarmChannelSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            .putExtra(Settings.EXTRA_CHANNEL_ID, AlarmService.CHANNEL);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve();
    }
}
