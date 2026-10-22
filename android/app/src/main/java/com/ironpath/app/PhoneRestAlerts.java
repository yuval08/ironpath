package com.ironpath.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.ironpath.wearlink.Diagnostics;
import com.ironpath.wearlink.RestEffects;
import org.json.JSONObject;

/**
 * The single phone path for rest side effects: the lock-screen countdown (formerly RestLivePlugin) and the
 * backup "Rest complete" alarm. apply() is idempotent: it re-arms everything from the RestView.
 */
public final class PhoneRestAlerts implements RestEffects {
    static final String LIVE_CHANNEL = "ironpath-rest-live";
    static final String ALERT_CHANNEL = "ironpath-rest";
    static final int ALERT_ID = 71001;
    static final int LIVE_ID = 71003;
    static final String ACTION_BACKUP = "com.ironpath.app.REST_BACKUP";
    static final String EXTRA_TAPPED = "com.ironpath.app.REST_ALERT_TAPPED";
    private static final int COLOR = 0xFF0F766E;
    private static final String DEFAULT_BODY = "Ready for your next set? Tap to return to your workout.";
    /** Avoids recording the same schedule twice per process. */
    private static String lastScheduled;

    @Override public void apply(Context context, JSONObject view) {
        JSONObject timer = view == null ? null : view.optJSONObject("timer");
        boolean running = timer != null && "running".equals(timer.optString("state")) && timer.optLong("remainingMs") > 0;
        if (running) {
            // A "Rest complete" left over from the previous rest is stale once a new one runs.
            NotificationManagerCompat.from(context).cancel(ALERT_ID);
            showCountdown(context, view.optLong("measuredAtWall", System.currentTimeMillis()) + timer.optLong("remainingMs"), timer.optJSONObject("next"));
        } else NotificationManagerCompat.from(context).cancel(LIVE_ID);
        JSONObject alert = timer == null ? null : timer.optJSONObject("alert");
        if (running && alert != null && "scheduled".equals(alert.optString("phoneBackup"))) scheduleBackup(context, timer);
        else cancelBackup(context);
        RestCoordinatorPlugin.emit(view);
    }

    // ---- lock-screen countdown ----
    /**
     * Ongoing notification with a system-drawn countdown. It ticks on the lock screen while the WebView is
     * suspended and removes itself at the deadline.
     */
    static void showCountdown(Context context, long endsAt, JSONObject next) {
        long left = endsAt - System.currentTimeMillis();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (left <= 0 || !manager.areNotificationsEnabled()) { manager.cancel(LIVE_ID); return; }
        ensureLiveChannel(context);
        String title = next == null || next.optString("title").isEmpty() ? "Resting" : "Rest · next: " + next.optString("title");
        String text = next == null || next.optString("text").isEmpty() ? "Tap to return to your workout." : next.optString("text");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, LIVE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rest).setColor(COLOR)
            .setContentTitle(title).setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setWhen(endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            .setTimeoutAfter(left).setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        PendingIntent tap = openApp(context, LIVE_ID, false);
        if (tap != null) builder.setContentIntent(tap);
        try { manager.notify(LIVE_ID, builder.build()); }
        catch (SecurityException error) { /* notification permission missing */ }
    }
    /**
     * Default importance (not low) so Android does not file it under "silent" notifications, which lock
     * screens hide by default; the channel itself is muted.
     */
    private static void ensureLiveChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(LIVE_CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(LIVE_CHANNEL, "Rest countdown", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Live rest countdown and next set, shown on the lock screen");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
    /** Same id and settings as the channel the LocalNotifications path creates (importance 4, vibration). */
    static void ensureAlertChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(ALERT_CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(ALERT_CHANNEL, "Rest timer", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alerts when your workout rest ends");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
    static int alertChannelImportance(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return NotificationManager.IMPORTANCE_HIGH;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(ALERT_CHANNEL);
        return channel == null ? -1 : channel.getImportance();
    }
    static PendingIntent openApp(Context context, int requestCode, boolean alertTap) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) return null;
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        if (alertTap) open.putExtra(EXTRA_TAPPED, true);
        return PendingIntent.getActivity(context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ---- backup alarm ----
    private static PendingIntent backupIntent(Context context, String timerId, long revision, long deadlineElapsed, int flags) {
        Intent intent = new Intent(context, RestAlertReceiver.class).setAction(ACTION_BACKUP)
            .putExtra("timerId", timerId).putExtra("revision", revision).putExtra("expectedElapsed", deadlineElapsed);
        return PendingIntent.getBroadcast(context, ALERT_ID, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void scheduleBackup(Context context, JSONObject timer) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        long deadline = SystemClock.elapsedRealtime() + timer.optLong("remainingMs");
        PendingIntent intent = backupIntent(context, timer.optString("timerId"), timer.optLong("revision"), deadline, PendingIntent.FLAG_UPDATE_CURRENT);
        boolean exact = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms();
        try {
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, deadline, intent);
            else alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, deadline, intent);
        } catch (SecurityException error) {
            exact = false;
            alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, deadline, intent);
        }
        String key = timer.optString("timerId") + ":" + timer.optLong("revision");
        if (key.equals(lastScheduled)) return;
        lastScheduled = key;
        try {
            Diagnostics.record(context, "rest.scheduled", new JSONObject().put("timerId", timer.optString("timerId"))
                .put("revision", timer.optLong("revision")).put("sessionId", timer.opt("sessionId"))
                .put("data", new JSONObject().put("deadlineWall", System.currentTimeMillis() + timer.optLong("remainingMs"))
                    .put("remainingMs", timer.optLong("remainingMs")).put("exact", exact).put("scheduler", "alarm")
                    .put("destination", timer.getJSONObject("alert").optString("destination"))));
        } catch (Exception ignored) { /* diagnostics only */ }
    }
    static void cancelBackup(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        PendingIntent intent = backupIntent(context, "", 0, 0, PendingIntent.FLAG_NO_CREATE);
        if (alarms != null && intent != null) { alarms.cancel(intent); intent.cancel(); }
        lastScheduled = null;
    }
    /** Posts the backup "Rest complete" alert. Returns whether it was posted. */
    static boolean postAlert(Context context, JSONObject timer, boolean vibrate) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return false;
        ensureAlertChannel(context);
        JSONObject next = timer == null ? null : timer.optJSONObject("next");
        String body = next == null ? DEFAULT_BODY : (next.optString("title") + " · " + next.optString("text"));
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ALERT_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rest).setColor(COLOR)
            .setContentTitle("Rest complete").setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSilent(!vibrate);
        PendingIntent tap = openApp(context, ALERT_ID, true);
        if (tap != null) builder.setContentIntent(tap);
        try { manager.notify(ALERT_ID, builder.build()); return true; }
        catch (SecurityException error) { return false; }
    }
}
