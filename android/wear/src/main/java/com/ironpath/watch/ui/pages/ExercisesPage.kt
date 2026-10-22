package com.ironpath.watch.ui.pages

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.state.Step
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.components.ListScreen
import com.ironpath.watch.ui.components.SlotBadge
import com.ironpath.watch.ui.components.header
import com.ironpath.watch.ui.components.itemModifier
import com.ironpath.watch.ui.components.transformation

/** One row per prescription, in snapshot order. Ramp sets do not count. */
data class ExerciseRow(val prescriptionId: String, val name: String, val slot: String?, val done: Int, val total: Int, val supported: Boolean) {
    val complete get() = total > 0 && done >= total

    companion object {
        fun of(steps: List<Step>): List<ExerciseRow> = steps.groupBy { it.prescriptionId }.map { (id, sets) ->
            val working = sets.filter { !it.isWarmUp }
            ExerciseRow(id, sets.first().name, sets.first().slot, working.count { it.completed }, working.size, sets.any { it.supported })
        }
    }
}

/** S5: tap an exercise to jump to its first open set on the Now page. */
@Composable
fun ExercisesPage(state: WatchUiState, onSelect: (String) -> Unit) {
    val rows = ExerciseRow.of(state.snapshot.steps)
    val current = state.currentStep?.prescriptionId
    ListScreen { spec ->
        header(spec, "Exercises")
        items(rows, key = { it.prescriptionId }) { row ->
            val isCurrent = row.prescriptionId == current
            FilledTonalButton(
                onClick = { onSelect(row.prescriptionId) },
                modifier = itemModifier(spec),
                transformation = transformation(spec),
                border = if (isCurrent) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
                icon = {
                    when {
                        !row.supported -> Icon(Icons.Filled.Phone, contentDescription = "Log on phone", Modifier.size(ButtonDefaults.SmallIconSize))
                        row.complete -> Icon(Icons.Filled.Check, contentDescription = "Done", Modifier.size(ButtonDefaults.SmallIconSize))
                        isCurrent -> Icon(Icons.Filled.PlayArrow, contentDescription = "Current", Modifier.size(ButtonDefaults.SmallIconSize),
                            tint = MaterialTheme.colorScheme.primary)
                    }
                },
                secondaryLabel = { Text(if (row.supported) "${row.done}/${row.total}" else "Phone") },
                label = {
                    if (row.slot != null) SlotBadge(row.slot, Modifier.padding(end = 4.dp))
                    Text(row.name, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        color = if (row.complete) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                },
            )
        }
    }
}

