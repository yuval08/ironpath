package com.ironpath.watch.ui

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import com.ironpath.watch.state.Format
import com.ironpath.watch.state.Phase
import com.ironpath.watch.state.Prefill
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.theme.AmbientGray
import com.ironpath.watch.ui.theme.LocalAmbient
import java.text.DateFormat
import java.util.Date

/**
 * Always-on rendering (§5.6): outlines and gray/white text only, no buttons, redrawn about once
 * a minute. With burn-in protection the content shifts ±4 dp on each update.
 */
@Composable
fun AmbientScreen(state: WatchUiState) {
    val ambient = LocalAmbient.current
    val shift = if (ambient.burnInProtection) (((ambient.tick % 3) - 1) * 4).dp else 0.dp
    val now = remember(ambient.tick) { SystemClock.elapsedRealtime() }
    Box(Modifier.fillMaxSize().background(Color.Black).offset(shift, shift)) {
        TimeText()
        val rest = state.snapshot.runningRest
        val step = state.currentStep
        when {
            rest != null -> {
                val remaining = rest.remainingAt(now)
                // Arc at the whole-minute position, so it does not need per-second updates.
                val minutes = (remaining + 59_999) / 60_000 * 60_000
                CircularProgressIndicator(
                    progress = { (minutes / rest.durationMs.coerceAtLeast(1).toFloat()).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxSize().padding(2.dp), strokeWidth = 2.dp, startAngle = 270f,
                    colors = ProgressIndicatorDefaults.colors(indicatorColor = AmbientGray, trackColor = Color.Transparent),
                )
                val endsAt = remember(rest.timerId, rest.localRev) { System.currentTimeMillis() + remaining }
                Centered {
                    Text(Format.ambientMinutes(remaining), style = MaterialTheme.typography.numeralMedium, color = Color.White)
                    Text("Ends ${DateFormat.getTimeInstance(DateFormat.MEDIUM).format(Date(endsAt))}",
                        style = MaterialTheme.typography.bodySmall, color = AmbientGray)
                }
            }
            state.phase == Phase.Active && step != null -> Centered {
                Text(step.name, style = MaterialTheme.typography.titleMedium, color = Color.White, textAlign = TextAlign.Center, maxLines = 2)
                Text(step.position, style = MaterialTheme.typography.labelMedium, color = AmbientGray)
                if (step.supported) {
                    val values = state.editor?.takeIf { it.setId == step.setId }?.values(step, Prefill.values(step, state.snapshot.steps))
                        ?: Prefill.values(step, state.snapshot.steps)
                    Text(Format.setSummary(step, values), style = MaterialTheme.typography.titleLarge, color = Color.White)
                }
            }
            else -> Centered { Text(phaseTitle(state.phase), style = MaterialTheme.typography.titleMedium, color = Color.White) }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally) { content() }
}

private fun phaseTitle(phase: Phase) = when (phase) {
    Phase.Idle -> "Ironpath"
    Phase.Active -> "All sets done"
    Phase.Finishing -> "Finishing on phone"
    Phase.PhoneControl -> "Phone has control"
    Phase.Closed -> "Workout saved"
    Phase.UpdateNeeded -> "Update needed"
    Phase.Error -> "Can't read workout"
}
