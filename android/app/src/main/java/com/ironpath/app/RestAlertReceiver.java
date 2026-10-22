package com.ironpath.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;
import com.ironpath.wearlink.Diagnostics;
import com.ironpath.wearlink.RestCoordinator;
import org.json.JSONObject;

/** The phone backup alarm (claim, then alert) and boot re-arming. Work runs off the main thread. */
public final class RestAlertReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PendingResult pending = goAsync();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                if (PhoneRestAlerts.ACTION_BACKUP.equals(intent.getAction())) backup(app, intent);
                else RestCoordinator.recover(app); // boot / app update: re-anchor and re-arm
            } catch (Exception error) {
                Log.w("IronpathRest", "Rest alarm failed", error);
                try {
                    Diagnostics.record(app, "rest.failure", new JSONObject().put("data", new JSONObject()
                        .put("stage", "receiver").put("message", String.valueOf(error.getMessage()))));
                } catch (Exception ignored) { /* diagnostics only */ }
            } finally { pending.finish(); }
        }, "ironpath-rest-alarm").start();
    }
    private static void backup(Context context, Intent intent) throws Exception {
        String timerId = intent.getStringExtra("timerId");
        long revision = intent.getLongExtra("revision", -1), expected = intent.getLongExtra("expectedElapsed", 0);
        long actual = SystemClock.elapsedRealtime();
        Diagnostics.record(context, "rest.callback", new JSONObject().put("timerId", timerId).put("revision", revision)
            .put("data", new JSONObject().put("expectedElapsed", expected).put("actualElapsed", actual)
                .put("delayMs", actual - expected).put("source", "alarm")));
        JSONObject view = RestCoordinator.claimBackup(context, timerId, revision);
        if (view != null) {
            boolean vibrate = configVibrate(context);
            boolean posted = PhoneRestAlerts.postAlert(context, view.optJSONObject("timer"), vibrate);
            Diagnostics.record(context, "rest.delivered", new JSONObject().put("timerId", timerId).put("revision", revision)
                .put("data", new JSONObject().put("notificationPosted", posted).put("vibrationRequested", posted && vibrate)
                    .put("channelImportance", PhoneRestAlerts.alertChannelImportance(context))
                    .put("foreground", RestCoordinatorPlugin.foreground())));
        }
        // Clears the countdown and tells JS (restChanged) either way, from the state as stored now.
        RestCoordinator.applyEffects(context);
    }
    private static boolean configVibrate(Context context) {
        try (com.ironpath.wearlink.WorkStore store = new com.ironpath.wearlink.WorkStore(context)) {
            String config = store.state("restConfig");
            return config == null || new JSONObject(config).optBoolean("vibrate", true);
        } catch (Exception error) { return true; }
    }
}
