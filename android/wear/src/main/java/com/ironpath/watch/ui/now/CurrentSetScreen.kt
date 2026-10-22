package com.ironpath.watch.ui.now

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.ui.components.primaryEdgeButtonSize
import com.ironpath.watch.WatchViewModel
import com.ironpath.watch.state.Editor
import com.ironpath.watch.state.Field
import com.ironpath.watch.state.Format
import com.ironpath.watch.state.Prefill
import com.ironpath.watch.state.Step
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.components.ExerciseTitle
import com.ironpath.watch.ui.components.FixedScreen
import com.ironpath.watch.ui.components.UndoPill
import com.ironpath.watch.ui.components.ValueTile
import com.ironpath.watch.ui.components.rememberNow

/** Actions S2 can trigger; kept as one bundle so screens stay previewable. */
data class CurrentSetActions(
    val onAdjust: (Field) -> Unit = {},
    val onDone: () -> Unit = {},
    val onNext: () -> Unit = {},
    val onReview: () -> Unit = {},
    val onExercises: () -> Unit = {},
    val onUndo: () -> Unit = {},
)

/** S2: the logging screen. One tap on Done set logs the pre-filled values. */
@Composable
fun CurrentSetScreen(state: WatchUiState, actions: CurrentSetActions) {
    val steps = state.snapshot.steps
    val step = state.currentStep
    when {
        steps.isEmpty() -> Message("No sets to log on watch", "Use your phone for this workout.")
        step == null -> AllDone(actions.onExercises)
        !step.supported -> Unsupported(step, state, actions)
        else -> LogSet(step, state, actions)
    }
}

@Composable
private fun LogSet(step: Step, state: WatchUiState, actions: CurrentSetActions) {
    val prefill = Prefill.values(step, state.snapshot.steps)
    val editor = state.editor?.takeIf { it.setId == step.setId } ?: Editor.open(step)
    val values = editor.values(step, prefill)
    val repsReady = step.fields.filter { it != Field.Weight }.all { values[it] != null }
    val enabled = !state.busy && !step.review && repsReady && (!step.completed || editor.dirty(step, prefill))
    FixedScreen(edgeButton = {
        // An open review blocks logging this set, so resolving it becomes the one primary action.
        if (step.review) EdgeButton(onClick = actions.onReview, buttonSize = primaryEdgeButtonSize(), colors = reviewColors()) {
            Icon(Icons.Filled.Warning, contentDescription = null, Modifier.size(ButtonDefaults.ExtraSmallIconSize))
            Text("Review")
        } else EdgeButton(onClick = actions.onDone, buttonSize = primaryEdgeButtonSize(), enabled = enabled) {
            Text(if (step.completed) "Update set" else "Done set")
        }
    }) {
        StatusLine(state, actions.onUndo)
        ExerciseTitle(step.name, step.slot)
        if (step.completed) Text("✓ Logged", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        Text(step.position, style = MaterialTheme.typography.labelMedium,
            color = if (step.isWarmUp) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant)
        Tiles(step, values, editor, actions.onAdjust)
        if (step.target.isNotBlank()) Text("Target ${Format.target(step.target)}", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Tiles(step: Step, values: Map<Field, Double?>, editor: Editor, onAdjust: (Field) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
        val weighted = step.hasWeight || step.bandLabel != null
        val repsModifier = if (weighted) Modifier.weight(1f) else Modifier.fillMaxWidth(0.8f)
        if (step.perSide) {
            val text = "${Format.number(values[Field.RepsLeft])} / ${Format.number(values[Field.RepsRight])}"
            ValueTile(text, "L / R reps", "Reps per side, $text. Double tap to change.", { onAdjust(Field.RepsLeft) }, repsModifier,
                edited = Field.RepsLeft in editor.touched || Field.RepsRight in editor.touched,
                stale = Field.RepsLeft in editor.stale || Field.RepsRight in editor.stale)
        } else {
            val text = Format.number(values[Field.Reps])
            ValueTile(text, "reps", "Reps, $text. Double tap to change.", { onAdjust(Field.Reps) }, repsModifier,
                edited = Field.Reps in editor.touched, stale = Field.Reps in editor.stale)
        }
        if (step.hasWeight) {
            val text = Format.number(values[Field.Weight])
            ValueTile(text, step.unit, "Weight, $text ${unitName(step.unit)}. Double tap to change.", { onAdjust(Field.Weight) },
                Modifier.weight(1f), edited = Field.Weight in editor.touched, stale = Field.Weight in editor.stale)
        } else if (step.bandLabel != null) {
            // Bands are changed on the phone; the tile is read-only.
            ValueTile(step.bandLabel, "band", "Band, ${step.bandLabel}.", null, Modifier.weight(1f), textValue = true)
        }
    }
}

/** Undo pill for 6 s after Done set, otherwise the short "Next: A2" / "Finish cancelled" flash. */
@Composable
internal fun StatusLine(state: WatchUiState, onUndo: () -> Unit) {
    val now = rememberNow()
    val left = state.undoPillUntil - now
    val undo = state.snapshot.undo
    when {
        left > 0 && state.snapshot.canUndo ->
            UndoPill(undo?.label ?: "Undo set", left / WatchViewModel.UNDO_MS.toFloat(), onUndo, enabled = !state.busy)
        state.flash != null && now < state.flash.untilElapsed ->
            Text(state.flash.text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun reviewColors() = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer,
    contentColor = MaterialTheme.colorScheme.onErrorContainer, iconColor = MaterialTheme.colorScheme.onErrorContainer)

@Composable
private fun Unsupported(step: Step, state: WatchUiState, actions: CurrentSetActions) {
    val hasNext = state.snapshot.steps.dropWhile { it.setId != step.setId }.drop(1).any { it.supported && !it.completed }
    FixedScreen(edgeButton = if (hasNext) ({
        EdgeButton(onClick = actions.onNext, buttonSize = primaryEdgeButtonSize()) { Text("Next") }
    }) else null) {
        StatusLine(state, actions.onUndo)
        ExerciseTitle(step.name, step.slot)
        Text(step.position, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (step.target.isNotBlank()) Text(step.target, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Phone, contentDescription = null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
            Text("Log on phone", style = MaterialTheme.typography.titleSmall)
        }
    }
}

@Composable
private fun AllDone(onExercises: () -> Unit) {
    FixedScreen(edgeButton = {
        EdgeButton(onClick = onExercises, buttonSize = primaryEdgeButtonSize()) { Text("Exercises") }
    }) {
        Icon(Icons.Filled.Check, contentDescription = null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.primary)
        Text("All sets done", style = MaterialTheme.typography.titleMedium)
        Text("Finish on your phone", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Message(title: String, body: String) {
    FixedScreen {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

internal fun unitName(unit: String) = if (unit == "lb") "pounds" else "kilograms"
