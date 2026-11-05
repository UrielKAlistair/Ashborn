package dev.ashborn.app;

import android.content.Intent;
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
    void showOverLockScreen(boolean show) {
        setShowWhenLocked(show);
        setTurnScreenOn(show);
        if (show) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
