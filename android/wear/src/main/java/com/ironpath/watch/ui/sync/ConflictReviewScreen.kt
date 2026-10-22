package com.ironpath.watch.ui.sync

import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.Text
import com.ironpath.watch.ui.components.primaryEdgeButtonSize
import com.ironpath.watch.state.Conflict
import com.ironpath.watch.state.Format
import com.ironpath.watch.ui.components.FixedScreen
import com.ironpath.watch.ui.components.isCompactScreen

/**
 * S8: one conflict at a time. **Keep phone** is the safe default; **Use watch value** sends a new
 * conditional mutation. Both advance; after the last one the screen pops back to S7.
 */
@Composable
fun ConflictReviewScreen(conflicts: List<Conflict>, busy: Boolean, onResolve: (String, Boolean) -> Unit, onDone: () -> Unit) {
    val open = conflicts.filter { it.queuedResolution == null }
    val conflict = open.firstOrNull()
    LaunchedEffect(conflict == null) { if (conflict == null) onDone() }
    if (conflict == null) return
    val index = conflicts.size - open.size + 1
    FixedScreen(verticalArrangement = Arrangement.spacedBy(0.dp, Alignment.CenterVertically), edgeButton = {
        EdgeButton(onClick = { onResolve(conflict.id, true) }, buttonSize = primaryEdgeButtonSize(), enabled = !busy) { Text("Keep phone") }
    }) {
        if (conflicts.size > 1) Text("Review $index of ${conflicts.size}", style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(listOf(conflict.exerciseName, conflict.position).filter { it.isNotBlank() }.joinToString(" · "),
            Modifier.basicMarquee(), style = MaterialTheme.typography.titleSmall, maxLines = 1)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            ValueColumn("Phone", conflict, phone = true, MaterialTheme.colorScheme.onSurface)
            ValueColumn("Watch", conflict, phone = false, MaterialTheme.colorScheme.tertiary)
        }
        Format.alsoChanged(conflict.alsoChanged)?.let {
            Text(it, Modifier.basicMarquee(), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        // Compact screens use the 32 dp outlined pill (48 dp touch) so it stays clear of the EdgeButton.
        if (isCompactScreen()) CompactButton(onClick = { onResolve(conflict.id, false) }, enabled = !busy,
            colors = ButtonDefaults.outlinedButtonColors(), border = ButtonDefaults.outlinedButtonBorder(enabled = !busy),
            label = { Text("Use watch value") })
        else OutlinedButton(onClick = { onResolve(conflict.id, false) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text("Use watch value")
        }
    }
}

/** "Phone / 8": only the conflicting fields, bold (and tinted on the watch side). */
@Composable
private fun ValueColumn(label: String, conflict: Conflict, phone: Boolean, changed: Color) {
    val text = buildAnnotatedString {
        val fields = conflict.conflicting
        fields.forEachIndexed { i, field ->
            if (i > 0) append(" · ")
            if (fields.size > 1) append("${Format.fieldLabel(field.field)} ")
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = changed)) {
                append(Format.conflictValue(if (phone) field.phone else field.watch))
            }
        }
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
    }
}
