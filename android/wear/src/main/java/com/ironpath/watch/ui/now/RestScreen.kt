package com.ironpath.watch.ui.now

import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ironpath.watch.ui.components.ColumnScrollInfo
import com.ironpath.watch.ui.components.FixedPadding
import com.ironpath.watch.ui.components.isCompactScreen
import com.ironpath.watch.ui.components.primaryEdgeButtonSize
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.ScreenScaffoldDefaults
import androidx.wear.compose.material3.Text
import com.ironpath.watch.state.Format
import com.ironpath.watch.state.Prefill
import com.ironpath.watch.state.RestUi
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.components.rememberNow

data class RestActions(
    val onAdjust: (Int) -> Unit = {},
    val onSkip: () -> Unit = {},
    val onPeek: () -> Unit = {},
    val onUndo: () -> Unit = {},
)

/** S4: full-edge arc, the biggest countdown on the watch, −15/+15, next-up card, Skip. */
@Composable
fun RestScreen(state: WatchUiState, rest: RestUi, warnBeforeEnd: Boolean, actions: RestActions) {
    val now = rememberNow()
    val remaining = rest.remainingAt(now)
    val total = rest.durationMs.coerceAtLeast(1)
    val ending = remaining <= 10_000
    val accent = if (ending) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary
    val haptics = LocalHapticFeedback.current
    val compact = isCompactScreen()
    // ±15 buttons: 52 dp, or 48 dp (the touch minimum) on compact screens.
    val adjustSize = if (compact) 48.dp else 52.dp
    LaunchedEffect(rest.timerId, rest.localRev, ending) {
        if (ending && warnBeforeEnd && remaining > 0) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
    }
    Box(Modifier.fillMaxSize()) {
        CircularProgressIndicator(
            progress = { remaining / total.toFloat() },
            modifier = Modifier.fillMaxSize().padding(2.dp),
            strokeWidth = 8.dp,
            startAngle = 270f,
            colors = ProgressIndicatorDefaults.colors(indicatorColor = accent, trackColor = MaterialTheme.colorScheme.surfaceContainer),
        )
        val scroll = rememberScrollState()
        ScreenScaffold(
            scrollInfoProvider = remember(scroll) { ColumnScrollInfo(scroll) },
            contentPadding = FixedPadding,
            edgeButtonSpacing = ScreenScaffoldDefaults.EdgeButtonMinSpacing,
            edgeButton = {
                EdgeButton(onClick = actions.onSkip, buttonSize = primaryEdgeButtonSize(), enabled = !state.busy,
                    colors = ButtonDefaults.filledTonalButtonColors()) { Text("Skip") }
            },
        ) { padding ->
            Column(
                Modifier.fillMaxSize().padding(padding),
                verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // Compact screens drop the "Rest" label (the arc says it) and use the 50 sp numeral.
                if (!compact) Text("Rest", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Countdown(remaining, accent, compact)
                rest.recovery?.let {
                    Text(it, Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, maxLines = 2)
                }
                // For 6 s after Done set the undo pill takes this row; then −15 · next-up · +15.
                if (state.undoPillUntil > now && state.snapshot.canUndo) StatusLine(state, actions.onUndo)
                else Row(Modifier.padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    FilledTonalIconButton(onClick = { actions.onAdjust(-15) }, enabled = !state.busy && remaining > 15_000,
                        modifier = Modifier.size(adjustSize).semantics { contentDescription = "Subtract 15 seconds" }) {
                        Text("−15", style = MaterialTheme.typography.labelMedium)
                    }
                    NextUpCard(state, actions.onPeek, Modifier.weight(1f))
                    FilledTonalIconButton(onClick = { actions.onAdjust(15) }, enabled = !state.busy,
                        modifier = Modifier.size(adjustSize).semantics { contentDescription = "Add 15 seconds" }) {
                        Text("+15", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}


/** Countdown text. TalkBack hears it every 15 s and at 10 s, not every second. */
@Composable
private fun Countdown(remaining: Long, color: androidx.compose.ui.graphics.Color, compact: Boolean) {
    val announced = if (remaining <= 10_000) minOf(remaining, 10_000) else ((remaining + 14_999) / 15_000) * 15_000
    Text(
        Format.clock(remaining),
        modifier = Modifier.semantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = Format.restDescription(announced)
        },
        style = (if (compact) MaterialTheme.typography.numeralLarge else MaterialTheme.typography.numeralExtraLarge)
            .let { it.copy(lineHeight = it.fontSize) },
        color = color,
        maxLines = 1,
    )
}

/**
 * Compact next-up: "Next · A1 Bench Press" (one marquee line) over the planned reps × load.
 * Tap to look at the upcoming set while rest keeps running.
 */
@Composable
private fun NextUpCard(state: WatchUiState, onPeek: () -> Unit, modifier: Modifier) {
    val next = state.snapshot.next ?: return Box(modifier)
    val step = state.snapshot.step(next.setId)
    val title = "Next · ${listOfNotNull(next.slot, next.name).joinToString(" ")}"
    // Compact screens drop the unit so "8 × 62.5" fits between the ±15 buttons.
    val withUnit = !isCompactScreen()
    val plan = step?.let { Format.setSummary(it, Prefill.values(it, state.snapshot.steps), withUnit) } ?: next.position
    Column(
        modifier.clickable(role = Role.Button, onClickLabel = "Show next set", onClick = onPeek)
            .semantics(mergeDescendants = true) { contentDescription = "$title, $plan" },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, Modifier.basicMarquee(), style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        Text(plan, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}
