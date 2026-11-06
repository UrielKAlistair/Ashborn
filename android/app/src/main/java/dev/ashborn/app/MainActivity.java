package dev.ashborn.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmPlugin.class);
        super.onCreate(savedInstanceState);
        showOverLockScreen(AlarmScheduler.ringing(this) != null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        showOverLockScreen(AlarmScheduler.ringing(this) != null);
    }

    // Again on each return to the front: a ring dismissed from its notification ends without the app
    @Override
    public void onResume() {
        super.onResume();
        showOverLockScreen(AlarmScheduler.ringing(this) != null);
    }

    // While an alarm rings the app shows over the lock screen, turns the screen on, and keeps it on,
    // since a dark screen stops the motion events a challenge counts
    // (Android before 8.1 has no setShowWhenLocked or setTurnScreenOn, only the window flags.)
    @SuppressWarnings("deprecation")
    void showOverLockScreen(boolean show) {
        int flags = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(show);
            setTurnScreenOn(show);
        } else {
            flags |= WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
        }
        if (show) getWindow().addFlags(flags);
        else getWindow().clearFlags(flags);
    }
}
