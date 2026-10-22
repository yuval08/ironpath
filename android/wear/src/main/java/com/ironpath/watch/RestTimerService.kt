package com.ironpath.watch

import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service that runs only while rest runs. It keeps a wake lock until the deadline and
 * delivers through [RestRuntime.deliver]; the alarm remains the fallback.
 */
class RestTimerService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var wakeLock: PowerManager.WakeLock? = null
    private val changed = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { refresh() }
    }

    override fun onCreate() {
        super.onCreate()
        RestRuntime.channels(this)
        ContextCompat.registerReceiver(this, changed, IntentFilter(RestRuntime.CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Always meet the foreground-start deadline, even if Skip raced with service creation.
        startForeground(RestRuntime.ONGOING, placeholder())
        refresh()
        return START_STICKY
    }

    private fun placeholder(): Notification = NotificationCompat.Builder(this, RestRuntime.RUNNING_CHANNEL)
        .setSmallIcon(R.drawable.ic_timer).setContentTitle("Ironpath").setContentText("Rest")
        .setContentIntent(RestRuntime.open(this)).setOngoing(true).setSilent(true).build()

    private fun refresh() {
        handler.removeCallbacksAndMessages(null)
        try {
            val snapshot = RestRuntime.read(this, recover = true)
            val rest = snapshot.runningRest ?: run { stopSelf(); return }
            val left = rest.remainingAt(SystemClock.elapsedRealtime())
            if (left == 0L) { RestRuntime.deliver(this, rest.timerId, rest.localRev, "service"); return }
            Ongoing.update(this, snapshot)
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Ironpath:rest")
                .apply { acquire(minOf(left + 3000, 10 * 60 * 1000L)) }
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
        // Detach: the workout-long ongoing notification outlives the rest (Ongoing owns it).
        stopForeground(STOP_FOREGROUND_DETACH)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?) = null
}
