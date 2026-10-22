package com.ironpath.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ongoing rest notification with a system-drawn countdown. The chronometer keeps
 * ticking on the lock screen while the WebView is suspended, and the notification
 * removes itself at the deadline, where the scheduled "rest complete" alert takes over.
 */
@CapacitorPlugin(name = "RestLive")
public final class RestLivePlugin extends Plugin {
    private static final String CHANNEL_ID = "ironpath-rest-live";
    private static final int NOTIFICATION_ID = 71003;

    @PluginMethod
    public void show(PluginCall call) {
        Long endsAt = call.getLong("endsAt");
        if (endsAt == null) { call.reject("Missing endsAt"); return; }
        long left = endsAt - System.currentTimeMillis();
        Context context = getContext();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (left <= 0 || !manager.areNotificationsEnabled()) {
            manager.cancel(NOTIFICATION_ID);
            call.resolve();
            return;
        }
        ensureChannel(context);
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(
            context, NOTIFICATION_ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = call.getString("title", "Resting");
        String text = call.getString("text", "");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_rest)
            .setColor(0xFF0F766E)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setWhen(endsAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setTimeoutAfter(left)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (tap != null) builder.setContentIntent(tap);
        try {
            manager.notify(NOTIFICATION_ID, builder.build());
            call.resolve();
        } catch (SecurityException error) {
            call.reject("Notification permission missing");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
        call.resolve();
    }

    /**
     * Default importance (not low) so Android does not file it under "silent"
     * notifications, which lock screens hide by default; the channel itself is muted.
     */
    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Rest countdown", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Live rest countdown and next set, shown on the lock screen");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
}
