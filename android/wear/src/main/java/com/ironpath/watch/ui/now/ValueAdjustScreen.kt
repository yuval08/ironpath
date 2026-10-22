package com.ironpath.watch.ui.now

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ironpath.watch.ui.components.primaryEdgeButtonSize
import com.ironpath.watch.ui.components.ColumnScrollInfo
import com.ironpath.watch.ui.components.FixedPadding
import com.ironpath.watch.ui.components.isCompactScreen
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Picker
import androidx.wear.compose.material3.PickerGroup
import androidx.wear.compose.material3.PickerState
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.ScreenScaffoldDefaults
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.rememberPickerState
import com.ironpath.watch.state.Editor
import com.ironpath.watch.state.Field
import com.ironpath.watch.state.Format
import com.ironpath.watch.state.LoadSteps
import com.ironpath.watch.state.Prefill
import com.ironpath.watch.state.Step
import com.ironpath.watch.state.WatchUiState
import kotlinx.coroutines.launch

/**
 * S3: rotary picker for one value (or L/R for per-side reps). **Set** writes into the editor
 * only and pops back; swipe-right discards. Off-grid values stay in the list unchanged.
 */
@Composable
fun ValueAdjustScreen(state: WatchUiState, field: Field, onSet: (Map<Field, Double?>) -> Unit) {
    val step = state.currentStep ?: return
    val prefill = Prefill.values(step, state.snapshot.steps)
    val editor = state.editor?.takeIf { it.setId == step.setId } ?: Editor.open(step)
    val fields = if (field == Field.RepsLeft || field == Field.RepsRight) listOf(Field.RepsLeft, Field.RepsRight) else listOf(field)
    val columns = fields.map { f -> rememberColumn(step, f, editor.value(f, prefill)) }
    var focused by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()

    ScreenScaffold(
        scrollInfoProvider = remember(scroll) { ColumnScrollInfo(scroll) },
        contentPadding = FixedPadding,
        edgeButtonSpacing = ScreenScaffoldDefaults.EdgeButtonMinSpacing,
        edgeButton = {
            EdgeButton(onClick = { onSet(columns.associate { it.field to it.value }) }, buttonSize = primaryEdgeButtonSize()) { Text("Set") }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title(step, field), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            fields.firstNotNullOfOrNull { f -> editor.stale[f]?.let { "Phone changed this to ${Format.number(it)}" } }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            }
            val pickerModifier = Modifier.weight(1f)
            if (columns.size == 1) {
                val column = columns.single()
                Picker(column.state, contentDescription = { column.description(step) }, modifier = pickerModifier.fillMaxWidth()) { index ->
                    Option(column.options[index], index == column.state.selectedOptionIndex)
                }
            } else {
                PickerGroup(pickerModifier, selectedPickerState = columns[focused].state, autoCenter = false) {
                    columns.forEachIndexed { i, column ->
                        PickerGroupItem(
                            pickerState = column.state,
                            selected = focused == i,
                            onSelected = { focused = i },
                            contentDescription = { column.description(step) },
                            modifier = Modifier.width(64.dp).then(
                                if (focused == i) Modifier.border(BorderStroke(2.dp, MaterialTheme.colorScheme.primary), RoundedCornerShape(16.dp))
                                else Modifier),
                        ) { index, selected -> Option(column.options[index], selected && index == column.state.selectedOptionIndex) }
                    }
                }
            }
            // The shortcut needs its own row; compact screens skip it (the pre-fill already is the target).
            val shortcut = if (columns.size == 2) "Same both sides" to {
                scope.launch { columns[1].scrollTo(columns[0].value) }; Unit
            } else target(step, field)?.let { t -> "Target ${Format.number(t)}" to { scope.launch { columns[0].scrollTo(t) }; Unit } }
            if (!isCompactScreen()) shortcut?.let { (label, action) ->
                CompactButton(onClick = action, colors = ButtonDefaults.filledTonalButtonColors(), label = { Text(label) })
            }
        }
    }
}

@Composable
private fun Option(value: Double, selected: Boolean) {
    Text(
        Format.number(value),
        style = if (selected) MaterialTheme.typography.numeralLarge else MaterialTheme.typography.numeralSmall,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (selected) 1f else 0.4f),
        maxLines = 1,
    )
}

private class PickerColumn(val field: Field, val options: List<Double>, val state: PickerState) {
    val value get() = options[state.selectedOptionIndex]
    suspend fun scrollTo(value: Double) = state.animateScrollToOption(LoadSteps.indexOf(options, value))
    fun description(step: Step) = when (field) {
        Field.Weight -> "Weight, ${Format.number(value)} ${unitName(step.unit)}"
        Field.RepsLeft -> "Left reps, ${Format.number(value)}"
        Field.RepsRight -> "Right reps, ${Format.number(value)}"
        Field.Reps -> "Reps, ${Format.number(value)}"
    }
}

@Composable
private fun rememberColumn(step: Step, field: Field, current: Double?): PickerColumn {
    val options = remember(step.setId, field) { LoadSteps.options(field, step, current) }
    val state = rememberPickerState(options.size, LoadSteps.indexOf(options, current), shouldRepeatOptions = false)
    return remember(options, state) { PickerColumn(field, options, state) }
}

private fun title(step: Step, field: Field) = when (field) {
    Field.Weight -> "Weight · ${step.unit}"
    Field.RepsLeft, Field.RepsRight -> "Reps · L / R"
    Field.Reps -> "Reps"
}

/** `‹ Target ›` fills the target's lower bound (reps) or the recommended weight. */
private fun target(step: Step, field: Field): Double? =
    if (field == Field.Weight) step.recommendedWeight else Prefill.targetReps(step.target)
