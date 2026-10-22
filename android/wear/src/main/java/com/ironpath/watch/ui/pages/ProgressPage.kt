package com.ironpath.watch.ui.pages

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.SegmentedCircularProgressIndicator
import androidx.wear.compose.material3.Text
import com.ironpath.watch.R
import com.ironpath.watch.state.Format
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.components.ListScreen
import com.ironpath.watch.ui.components.itemModifier
import com.ironpath.watch.ui.components.rememberNow
import com.ironpath.watch.ui.components.transformation
import com.ironpath.watch.ui.sync.SyncIndicator
import com.ironpath.watch.ui.sync.title

/** S6: information only. Working-set ring, elapsed time, undo, sync row and Settings. */
@Composable
fun ProgressPage(state: WatchUiState, onUndo: () -> Unit, onSync: () -> Unit, onSettings: () -> Unit) {
    val working = state.snapshot.steps.filter { !it.isWarmUp }
    val done = working.count { it.completed }
    val total = working.size
    val workout = state.snapshot.workout
    val now = rememberNow(periodMs = 15_000)
    Box(Modifier.fillMaxSize()) {
        val ringModifier = Modifier.fillMaxSize().padding(2.dp)
        if (total in 1..30) SegmentedCircularProgressIndicator(total, segmentValue = { it < done }, modifier = ringModifier, strokeWidth = 4.dp)
        else if (total > 30) CircularProgressIndicator(progress = { done / total.toFloat() }, modifier = ringModifier, strokeWidth = 4.dp)
        ListScreen { spec ->
            item {
                Text("$done / $total", itemModifier(spec), style = MaterialTheme.typography.numeralMedium, textAlign = TextAlign.Center)
            }
            item {
                Text("working sets", itemModifier(spec), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
            if (workout != null) item {
                Text("⏱ ${Format.minutes(workout.elapsedAt(now), workout.elapsedUncertain)}", itemModifier(spec),
                    style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }
            if (state.snapshot.canUndo) item {
                CompactButton(onClick = onUndo, enabled = !state.busy, transformation = transformation(spec),
                    colors = ButtonDefaults.filledTonalButtonColors(),
                    icon = { Icon(painterResource(R.drawable.ic_undo), contentDescription = null, Modifier.size(ButtonDefaults.ExtraSmallIconSize)) },
                    label = { Text(state.snapshot.undo?.label ?: "Undo last set") })
            }
            item {
                FilledTonalButton(onClick = onSync, modifier = itemModifier(spec), transformation = transformation(spec),
                    icon = { SyncIndicator(state.snapshot.syncState) },
                    label = { Text(state.snapshot.syncState.title()) })
            }
            item {
                FilledTonalButton(onClick = onSettings, modifier = itemModifier(spec), transformation = transformation(spec),
                    icon = { Icon(Icons.Filled.Settings, contentDescription = null, Modifier.size(ButtonDefaults.SmallIconSize)) },
                    label = { Text("Settings") })
            }
        }
    }
}
