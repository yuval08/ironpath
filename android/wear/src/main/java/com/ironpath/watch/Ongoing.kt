package com.ironpath.watch

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.ironpath.watch.state.Format
import com.ironpath.watch.state.Phase
import com.ironpath.watch.state.WatchSnapshot

/**
 * Workout-long ongoing notification + OngoingActivity (UI spec §5.7). It shows a TimerPart while
 * rest runs and "Bench · Set 2/4" between sets. The foreground service reuses [build] during rest.
 */
object Ongoing {
    fun build(context: Context, snapshot: WatchSnapshot): Notification? {
        if (snapshot.workout == null || snapshot.phase in setOf(Phase.Idle, Phase.Closed)) return null
        val rest = snapshot.runningRest
        val step = snapshot.step(snapshot.next?.setId)
        val between = step?.let { "${it.name} · ${it.position.replace(" of ", "/")}" } ?: "All sets done"
        val builder = NotificationCompat.Builder(context, RestRuntime.RUNNING_CHANNEL)
            .setSmallIcon(R.drawable.ic_timer).setContentTitle("Ironpath")
            .setCategory(if (rest != null) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_WORKOUT)
            .setContentIntent(RestRuntime.open(context)).setLocalOnly(true).setOngoing(true).setOnlyAlertOnce(true)
            .setSilent(true)
        val status = if (rest != null) {
            val left = rest.remainingAt(SystemClock.elapsedRealtime())
            builder.setContentText("Rest ${Format.clock(left)}").setWhen(System.currentTimeMillis() + left)
                .setUsesChronometer(true).setChronometerCountDown(true)
            Status.Builder().addTemplate("Rest #time#").addPart("time", Status.TimerPart(rest.endsElapsed)).build()
        } else {
            builder.setContentText(between)
            Status.Builder().addTemplate(between).build()
        }
        OngoingActivity.Builder(context, RestRuntime.ONGOING, builder)
            .setStaticIcon(R.drawable.ic_timer).setTouchIntent(RestRuntime.open(context)).setStatus(status)
            .build().apply(context)
        return builder.build()
    }

    /** Posts or clears the notification to match [snapshot]. Never throws. */
    fun update(context: Context, snapshot: WatchSnapshot) {
        val manager = context.getSystemService(NotificationManager::class.java)
        try {
            val notification = build(context, snapshot)
            if (notification == null) manager.cancel(RestRuntime.ONGOING) else manager.notify(RestRuntime.ONGOING, notification)
        } catch (error: SecurityException) {
            android.util.Log.w("IronpathTimer", "Ongoing notification not allowed", error)
        }
    }
}
