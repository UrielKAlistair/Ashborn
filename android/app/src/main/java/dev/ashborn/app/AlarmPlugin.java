package dev.ashborn.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
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

// The web app's handle on alarms (src/lib/alarms.ts): hand over the schedule, ask which alarm
// is ringing, stop it, and check the permissions alarms need
@CapacitorPlugin(name = "AshbornAlarm")
public class AlarmPlugin extends Plugin {
    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            JSArray array = call.getArray("alarms", new JSArray());
            List<Alarm> alarms = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) alarms.add(Alarm.fromJson(array.getJSONObject(i)));
            AlarmScheduler.schedule(getContext(), alarms);
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

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().startService(new Intent(getContext(), AlarmService.class).setAction(AlarmService.ACTION_STOP));
        getActivity().runOnUiThread(() -> ((MainActivity) getActivity()).showOverLockScreen(false));
        call.resolve();
    }

    // Notifications must be allowed for an alarm to show; on Android 14+ showing over the lock
    // screen is a separate switch for apps installed outside the Play Store. Battery optimisation
    // can delay or drop alarms, and Xiaomi's phones also stop apps that lack Autostart (which no
    // app can read, so it is only reported whether the phone is a Xiaomi).
    @PluginMethod
    public void permissions(PluginCall call) {
        boolean notifications = Build.VERSION.SDK_INT < 33
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean fullScreen = Build.VERSION.SDK_INT < 34 || getContext().getSystemService(NotificationManager.class).canUseFullScreenIntent();
        JSObject result = new JSObject();
        result.put("notifications", notifications);
        result.put("fullScreen", fullScreen);
        PowerManager power = getContext().getSystemService(PowerManager.class);
        result.put("battery", power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        result.put("xiaomi", "xiaomi".equalsIgnoreCase(Build.MANUFACTURER));
        call.resolve(result);
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
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

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
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
