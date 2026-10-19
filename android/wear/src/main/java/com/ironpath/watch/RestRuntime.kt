package com.ironpath.watch

import android.app.*
import android.content.*
import android.os.*
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.ironpath.wearlink.RestState
import com.ironpath.wearlink.WorkStore
import org.json.JSONObject

object RestRuntime {
    const val ONGOING = 201
    const val DONE = 202
    const val RUNNING_CHANNEL = "ironpath-running-rest"
    const val ALERT_CHANNEL = "ironpath-rest-alert"
    const val CHANGED = "com.ironpath.app.WORK_CHANGED"
    fun boot(context: Context): Int = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, 0)
    fun precise(context: Context): Boolean = Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(RUNNING_CHANNEL, "Rest countdown", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false) })
        manager.createNotificationChannel(NotificationChannel(ALERT_CHANNEL, "Rest finished", NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null); enableVibration(false) })
    }
    fun open(context: Context): PendingIntent = PendingIntent.getActivity(context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun alarm(context: Context, timer: JSONObject?): PendingIntent {
        val intent = Intent(context, RestAlarmReceiver::class.java).setAction("com.ironpath.app.REST_END")
        if (timer != null) intent.putExtra("id", timer.getString("id")).putExtra("revision", timer.getLong("revision"))
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    @Synchronized fun arm(context: Context) {
        channels(context)
        val timer = WorkStore(context).use { it.recoverRest(SystemClock.elapsedRealtime(), System.currentTimeMillis(), boot(context)) }
        val manager = context.getSystemService(AlarmManager::class.java)
        manager.cancel(alarm(context, null))
        if (timer == null || !timer.optBoolean("active")) {
            context.stopService(Intent(context, RestTimerService::class.java))
            context.getSystemService(NotificationManager::class.java).cancel(ONGOING)
        } else {
            context.getSystemService(NotificationManager::class.java).cancel(DONE)
            val token = alarm(context, timer)
            val deadline = timer.getLong("endsElapsed")
            if (precise(context)) manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, deadline, token)
            else manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, deadline, token)
        }
        context.sendBroadcast(Intent(CHANGED).setPackage(context.packageName))
    }
    fun startFromUser(context: Context) {
        arm(context)
        val timer = WorkStore(context).use { it.rest() }
        if (timer?.optBoolean("active") == true) androidx.core.content.ContextCompat.startForegroundService(context, Intent(context, RestTimerService::class.java))
    }
    @Suppress("MissingPermission")
    @Synchronized fun deliver(context: Context, id: String, revision: Long) {
        val timer = WorkStore(context).use { it.claimRest(id, revision, SystemClock.elapsedRealtime()) } ?: return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(ONGOING)
        manager.cancel(DONE)
        context.getSystemService(AlarmManager::class.java).cancel(alarm(context, null))
        context.stopService(Intent(context, RestTimerService::class.java))
        channels(context)
        val allowed = NotificationManagerCompat.from(context).areNotificationsEnabled()
            && manager.getNotificationChannel(ALERT_CHANNEL).importance != NotificationManager.IMPORTANCE_NONE
        if (allowed) {
            manager.notify(DONE, NotificationCompat.Builder(context, ALERT_CHANNEL).setSmallIcon(R.drawable.ic_timer)
                .setContentTitle("Rest finished").setContentText("Ready for your next set")
                .setContentIntent(open(context)).setAutoCancel(true).setLocalOnly(true).setOnlyAlertOnce(true).build())
            if (timer.optBoolean("vibrate", true)) {
                val vibrator = context.getSystemService(Vibrator::class.java)
                val effect = VibrationEffect.createWaveform(longArrayOf(0, 180, 90, 180), -1)
                if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.Builder().setUsage(VibrationAttributes.USAGE_NOTIFICATION).build())
                else @Suppress("DEPRECATION") vibrator.vibrate(effect, android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build())
            }
        }
        android.util.Log.i("IronpathTimer", "Rest completed; notification enabled=$allowed")
        context.sendBroadcast(Intent(CHANGED).setPackage(context.packageName))
    }
}

class RestAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            if (intent.action == Intent.ACTION_BOOT_COMPLETED) RestRuntime.arm(context)
            else RestRuntime.deliver(context, intent.getStringExtra("id") ?: return, intent.getLongExtra("revision", -1))
        } catch (error: Exception) { android.util.Log.e("IronpathTimer", "Could not restore or deliver timer", error) }
    }
}
