package com.ironpath.watch.ui.components

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.ironpath.watch.ui.theme.LocalAmbient
import kotlinx.coroutines.delay

/**
 * Device uptime that ticks every [periodMs] while interactive. In ambient it only changes on
 * `onUpdateAmbient` (about once a minute), so nothing ticks per second on the always-on screen.
 */
@Composable
fun rememberNow(periodMs: Long = 250): Long {
    val ambient = LocalAmbient.current
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(ambient.isAmbient, ambient.tick) {
        now = SystemClock.elapsedRealtime()
        if (!ambient.isAmbient) while (true) {
            delay(periodMs)
            now = SystemClock.elapsedRealtime()
        }
    }
    return now
}
