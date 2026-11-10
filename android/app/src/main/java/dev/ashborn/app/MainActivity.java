package dev.ashborn.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import java.lang.ref.WeakReference;
import com.getcapacitor.BridgeActivity;

// The app's one screen: Capacitor's web view holding the page, with three things only the activity
// can do. While an alarm rings it shows over the lock screen, turns the screen on and keeps it on
// (AlarmService tells it when a ring starts and ends). It keeps the screen on while a recipe is read.
// And Back asks the page first, so it closes a dialog or leaves a recipe before leaving the app.
// The ring and recipe hooks run on the main thread: AlarmService's callbacks are on it, and
// AlarmPlugin posts there.
public class MainActivity extends BridgeActivity {
    // Why the screen is kept on: a ring showing over the lock screen, or a recipe being read
    private boolean overLockScreen = false;
    private boolean reading = false;

    // The activity last brought to the front, for a ring that ends without the app (from its notification,
    // or by running out of time) to stop showing it over the lock screen and keeping the screen on
    private static WeakReference<MainActivity> shown = new WeakReference<>(null);

    static void ringEnded() {
        MainActivity activity = shown.get();
        if (activity != null) activity.showOverLockScreen(false);
    }

    // A ring starting while the app is already in front gets no full-screen launch to show it over the lock screen
    static void ringStarted() {
        MainActivity activity = shown.get();
        if (activity != null) activity.showOverLockScreen(true);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmPlugin.class);
        super.onCreate(savedInstanceState);
        showOverLockScreen(AlarmScheduler.ringing(this) != null);
        getOnBackPressedDispatcher().addCallback(this, backToPage);
    }

    // Back asks the page first (window.ashbornBack, set where the page has somewhere to go back to);
    // when it has nowhere, Back does what it does by default
    private final OnBackPressedCallback backToPage = new OnBackPressedCallback(true) {
        @Override
        public void handleOnBackPressed() {
            getBridge().getWebView().evaluateJavascript("window.ashbornBack ? window.ashbornBack() === true : false", (handled) -> {
                if ("true".equals(handled)) return;
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            });
        }
    };

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        showOverLockScreen(AlarmScheduler.ringing(this) != null);
    }

    // Again on each return to the front, in case a ring ended while it was away
    @Override
    public void onResume() {
        super.onResume();
        shown = new WeakReference<>(this);
        showOverLockScreen(AlarmScheduler.ringing(this) != null);
    }

    // While an alarm rings the app shows over the lock screen, turns the screen on, and keeps it on,
    // since a dark screen stops the motion events a challenge counts
    // (Android before 8.1 has no setShowWhenLocked or setTurnScreenOn, only the window flags.)
    @SuppressWarnings("deprecation")
    void showOverLockScreen(boolean show) {
        overLockScreen = show;
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(show);
            setTurnScreenOn(show);
        } else {
            int flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (show) getWindow().addFlags(flags);
            else getWindow().clearFlags(flags);
        }
        keepScreenOn();
    }

    // The page asks for the screen to stay on while a recipe is read (src/lib/alarms.ts keepScreenAwake)
    void keepAwake(boolean on) {
        reading = on;
        keepScreenOn();
    }

    private void keepScreenOn() {
        if (overLockScreen || reading) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
