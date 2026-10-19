package dev.ashborn.app;

import android.content.Intent;
import android.os.Bundle;
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

    // While an alarm rings the app shows over the lock screen and turns the screen on
    void showOverLockScreen(boolean show) {
        setShowWhenLocked(show);
        setTurnScreenOn(show);
    }
}
