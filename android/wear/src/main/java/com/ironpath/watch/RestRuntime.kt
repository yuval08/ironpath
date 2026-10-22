package com.ironpath.watch

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.ironpath.watch.state.RestUi
import com.ironpath.watch.state.SnapshotParser
import com.ironpath.watch.state.WatchSnapshot
import com.ironpath.wearlink.Clock
import com.ironpath.wearlink.Diagnostics
import com.ironpath.wearlink.WorkClient
import com.ironpath.wearlink.WorkStore
import org.json.JSONObject

/**
 * Android side of the watch rest timer. Alarms are keyed by (timerId, localRev), so a stale
 * callback can never alert for a newer revision; `claimRest` makes delivery happen exactly once.
 */
object RestRuntime {
    const val ONGOING = 201
    const val DONE = 202
    const val RUNNING_CHANNEL = "ironpath-running-rest"
    const val ALERT_CHANNEL = "ironpath-rest-alert"
    const val CHANGED = "com.ironpath.app.WORK_CHANGED"
    private const val TAG = "IronpathTimer"

    /** True while MainActivity is resumed: the screen already shows the end, so no notification. */
    @Volatile var foreground = false

    /** Last (timerId|localRev|armed|reason) reported, so re-arms don't enqueue duplicate packets. */
    private var lastReport: String? = null

    fun precise(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun notificationsAllowed(context: Context): Boolean {
        channels(context)
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(ALERT_CHANNEL)
        return NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            channel?.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(RUNNING_CHANNEL, "Workout in progress", NotificationManager.IMPORTANCE_LOW)
            .apply { setSound(null, null); enableVibration(false) })
        manager.createNotificationChannel(NotificationChannel(ALERT_CHANNEL, "Rest finished", NotificationManager.IMPORTANCE_HIGH)
            .apply { setSound(null, null); enableVibration(false) }) // Haptics.restEnd vibrates once itself.
    }

    fun open(context: Context): PendingIntent = PendingIntent.getActivity(context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun alarm(context: Context, rest: RestUi?): PendingIntent {
        val intent = Intent(context, RestAlarmReceiver::class.java).setAction("com.ironpath.app.REST_END")
        if (rest != null) intent.putExtra("id", rest.timerId).putExtra("localRev", rest.localRev)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Parsed store view. [recover] first re-anchors a timer across reboots (a write, so not per poll). */
    fun read(context: Context, recover: Boolean = false): WatchSnapshot = WorkStore(context).use { store ->
        if (recover) Clock.now(context).let { store.recoverRest(it.elapsed, it.wall, it.boot) }
        SnapshotParser.parse(store.inspect())
    }

    /**
     * Idempotent re-arm from stored state: alarm, ongoing notification and the armed report.
     * Called after every UI action and by [WatchApplication] as the `RestEffects` provider.
     */
    @Synchronized fun arm(context: Context): WatchSnapshot {
        channels(context)
        val snapshot = read(context, recover = true)
        val manager = context.getSystemService(AlarmManager::class.java)
        val rest = snapshot.runningRest
        manager.cancel(alarm(context, null))
        if (rest == null) {
            context.stopService(Intent(context, RestTimerService::class.java))
        } else {
            context.getSystemService(NotificationManager::class.java).cancel(DONE)
            val token = alarm(context, rest)
            val exact = precise(context)
            if (exact) manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, rest.endsElapsed, token)
            else manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, rest.endsElapsed, token)
            report(context, rest, exact)
        }
        Ongoing.update(context, snapshot)
        context.sendBroadcast(Intent(CHANGED).setPackage(context.packageName))
        return snapshot
    }

    /**
     * Tells the phone whether this revision's wrist alert is armed, so it can drop its backup.
     * The store substitutes `pendingOps` itself while local rest ops are unconfirmed.
     */
    private fun report(context: Context, rest: RestUi, exact: Boolean) {
        if (rest.test) return
        val reason = when {
            !NotificationManagerCompat.from(context).areNotificationsEnabled() -> "notificationsOff"
            !notificationsAllowed(context) -> "channelOff"
            !exact -> "exactDenied"
            else -> "ok"
        }
        val armed = reason == "ok"
        val key = "${rest.timerId}|${rest.localRev}|$armed|$reason"
        if (key == lastReport) return
        try {
            WorkStore(context).use { it.reportArmed(rest.timerId, rest.localRev, armed, reason, exact) }
            lastReport = key
            WorkClient.flush(context)
        } catch (error: Exception) {
            android.util.Log.w(TAG, "Could not report armed state", error) // legacy mode or storage error
        }
    }

    /** Arms, then keeps the countdown alive in a foreground service. Returns false if the service failed. */
    fun startFromUser(context: Context): Boolean {
        val snapshot = arm(context)
        if (snapshot.runningRest == null) return true
        return try {
            ContextCompat.startForegroundService(context, Intent(context, RestTimerService::class.java))
            true
        } catch (error: Exception) {
            Diagnostics.record(context, "rest.failure", JSONObject().put("data", JSONObject()
                .put("stage", "service").put("message", error.javaClass.simpleName)))
            false
        }
    }

    /** Rest end: claim once, buzz once, notify only when the app is not on screen. */
    @Synchronized fun deliver(context: Context, id: String, localRev: Long, source: String) {
        val now = SystemClock.elapsedRealtime()
        val timer = WorkStore(context).use { it.claimRest(id, localRev, now) } ?: return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(DONE)
        context.getSystemService(AlarmManager::class.java).cancel(alarm(context, null))
        context.stopService(Intent(context, RestTimerService::class.java))
        val expected = timer.optLong("endsElapsed", now)
        Diagnostics.record(context, "rest.callback", event(id, localRev, JSONObject().put("expectedElapsed", expected)
            .put("actualElapsed", now).put("delayMs", now - expected).put("source", source)))

        val vibrated = timer.optBoolean("vibrate", true) && Haptics.restEnd(context)
        val allowed = notificationsAllowed(context)
        val posted = allowed && !foreground
        if (posted) manager.notify(DONE, NotificationCompat.Builder(context, ALERT_CHANNEL).setSmallIcon(R.drawable.ic_timer)
            .setContentTitle("Rest finished").setContentText("Ready for your next set")
            .setCategory(NotificationCompat.CATEGORY_ALARM).setContentIntent(open(context))
            .setAutoCancel(true).setLocalOnly(true).setOnlyAlertOnce(true).build())
        Diagnostics.record(context, "rest.delivered", event(id, localRev, JSONObject().put("notificationPosted", posted)
            .put("vibrationRequested", vibrated).put("channelImportance", manager.getNotificationChannel(ALERT_CHANNEL)?.importance ?: -1)
            .put("foreground", foreground)))
        Ongoing.update(context, read(context))
        context.sendBroadcast(Intent(CHANGED).setPackage(context.packageName))
    }

    private fun event(timerId: String, localRev: Long, data: JSONObject) =
        JSONObject().put("timerId", timerId).put("revision", localRev).put("data", data)
}

class RestAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        Thread {
            try {
                if (intent.action == Intent.ACTION_BOOT_COMPLETED) RestRuntime.arm(context)
                else RestRuntime.deliver(context, intent.getStringExtra("id") ?: return@Thread,
                    intent.getLongExtra("localRev", -1), "alarm")
            } catch (error: Exception) {
                android.util.Log.e("IronpathTimer", "Could not restore or deliver timer", error)
            } finally { pending.finish() }
        }.start()
    }
}
