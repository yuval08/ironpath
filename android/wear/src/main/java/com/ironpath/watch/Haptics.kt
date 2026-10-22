package com.ironpath.watch

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator

/** The one rest-end waveform. Only `RestRuntime.deliver()` calls it, after a successful claim. */
object Haptics {
    // Two short buzzes and one long, about 1 s (UI spec §5.5).
    private val TIMINGS = longArrayOf(0, 200, 100, 200, 100, 400)
    private val AMPLITUDES = intArrayOf(0, 255, 0, 255, 0, 255)

    /** Returns true when the vibration was requested (not proof it was felt). */
    fun restEnd(context: Context): Boolean {
        val vibrator = context.getSystemService(Vibrator::class.java) ?: return false
        if (!vibrator.hasVibrator()) return false
        val effect = VibrationEffect.createWaveform(TIMINGS, AMPLITUDES, -1)
        // Alarm usage (default) keeps Bedtime/DND from silencing a rest the user started.
        val alarm = WatchPrefs(context).alertInDnd
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.Builder()
            .setUsage(if (alarm) VibrationAttributes.USAGE_ALARM else VibrationAttributes.USAGE_NOTIFICATION).build())
        else @Suppress("DEPRECATION") vibrator.vibrate(effect, AudioAttributes.Builder()
            .setUsage(if (alarm) AudioAttributes.USAGE_ALARM else AudioAttributes.USAGE_NOTIFICATION).build())
        return true
    }
}
