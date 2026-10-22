package com.ironpath.app;

import android.app.AlarmManager;
import android.app.Application;
import android.app.NotificationManager;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationManagerCompat;
import com.ironpath.wearlink.Diagnostics;
import com.ironpath.wearlink.RestCoordinator;
import com.ironpath.wearlink.RestEffects;
import org.json.JSONArray;
import org.json.JSONObject;

/** Provides the phone's rest side effects to wear-link and records start-up diagnostics. */
public final class IronpathApplication extends Application implements RestEffects.Provider {
    private final PhoneRestAlerts alerts = new PhoneRestAlerts();

    @Override public RestEffects restEffects() { return alerts; }

    @Override public void onCreate() {
        super.onCreate();
        new Thread(() -> {
            try {
                Diagnostics.record(this, "app.start", new JSONObject().put("data", new JSONObject()
                    .put("versionName", getPackageManager().getPackageInfo(getPackageName(), 0).versionName)
                    .put("versionCode", Build.VERSION.SDK_INT >= 28 ? getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode() : 0)
                    .put("protocols", new JSONArray().put(1).put(2))));
                recordPermissions(this);
                // Repairs effects lost to process death between a commit and its apply().
                RestCoordinator.recover(this);
            } catch (Exception ignored) { /* best effort */ }
        }, "ironpath-start").start();
    }
    /** perm.snapshot, recorded only when it differs from the last one (start, resume, configure). */
    static void recordPermissions(android.content.Context context) {
        try { Diagnostics.recordIfChanged(context, "perm.snapshot", permissions(context)); }
        catch (Exception ignored) { /* diagnostics only */ }
    }
    private static JSONObject permissions(android.content.Context context) throws Exception {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        PowerManager power = context.getSystemService(PowerManager.class);
        return new JSONObject().put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
            .put("channelImportance", PhoneRestAlerts.alertChannelImportance(context))
            .put("exactAlarms", Build.VERSION.SDK_INT < 31 || (alarms != null && alarms.canScheduleExactAlarms()))
            .put("interruptionFilter", notifications == null ? -1 : notifications.getCurrentInterruptionFilter())
            .put("powerSave", power != null && power.isPowerSaveMode())
            .put("batteryOptimized", power != null && !power.isIgnoringBatteryOptimizations(context.getPackageName()));
    }
}
