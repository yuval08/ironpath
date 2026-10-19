package com.ironpath.watch

import android.app.*
import android.content.*
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import com.ironpath.wearlink.RestState
import com.ironpath.wearlink.WorkStore

class RestTimerService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private val changed = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { refresh() }
    }
    override fun onCreate() {
        super.onCreate()
        RestRuntime.channels(this)
        val filter = IntentFilter(RestRuntime.CHANGED)
        androidx.core.content.ContextCompat.registerReceiver(this, changed, filter, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Always meet the foreground-start deadline, even if Skip raced with service creation.
        startForeground(RestRuntime.ONGOING, notification(null))
        refresh()
        return START_STICKY
    }
    private fun notification(timer: org.json.JSONObject?): Notification {
        val builder = NotificationCompat.Builder(this, RestRuntime.RUNNING_CHANNEL)
            .setSmallIcon(R.drawable.ic_timer).setContentTitle("Ironpath rest")
            .setContentText("Rest countdown").setCategory(NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(RestRuntime.open(this)).setLocalOnly(true).setOngoing(true).setOnlyAlertOnce(true)
        if (timer != null) builder.setWhen(System.currentTimeMillis() + RestState.remaining(timer, SystemClock.elapsedRealtime()))
            .setUsesChronometer(true).setChronometerCountDown(true)
        OngoingActivity.Builder(this, RestRuntime.ONGOING, builder).setStaticIcon(R.drawable.ic_timer)
            .setTouchIntent(RestRuntime.open(this)).build().apply(this)
        return builder.build()
    }
    private fun refresh() {
        handler.removeCallbacksAndMessages(null)
        try {
            val timer = WorkStore(this).use { it.recoverRest(SystemClock.elapsedRealtime(), System.currentTimeMillis(), RestRuntime.boot(this)) }
            if (timer == null || !timer.optBoolean("active")) { stopSelf(); return }
            val left = RestState.remaining(timer, SystemClock.elapsedRealtime())
            if (left == 0L) { RestRuntime.deliver(this, timer.getString("id"), timer.getLong("revision")); return }
            getSystemService(NotificationManager::class.java).notify(RestRuntime.ONGOING, notification(timer))
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Ironpath:rest").apply {
                acquire(minOf(left + 3000, 10 * 60 * 1000L))
            }
            handler.postDelayed({ refresh() }, left)
        } catch (error: Exception) {
            android.util.Log.e("IronpathTimer", "Timer service failed; alarm fallback retained", error)
            stopSelf()
        }
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        unregisterReceiver(changed)
        wakeLock?.let { if (it.isHeld) it.release() }
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
    override fun onBind(intent: Intent?) = null
}
