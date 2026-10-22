package com.ironpath.watch.ui.phase

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.ui.components.primaryEdgeButtonSize
import com.ironpath.watch.state.Closed
import com.ironpath.watch.state.Format
import com.ironpath.watch.ui.components.FixedScreen
import com.ironpath.watch.ui.components.isCompactScreen

/** S10: the phone closed the session. Done clears it (pending items keep draining) → S1. */
@Composable
fun ClosedScreen(closed: Closed?, busy: Boolean, onDone: () -> Unit) {
    val warning = (closed?.unsynced ?: 0) > 0
    FixedScreen(edgeButton = {
        EdgeButton(onClick = onDone, buttonSize = primaryEdgeButtonSize(), enabled = !busy) { Text("Done") }
    }) {
        Icon(if (warning) Icons.Filled.Warning else Icons.Filled.Check, contentDescription = null, Modifier.size(if (isCompactScreen()) 32.dp else 48.dp),
            tint = if (warning) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary)
        // Compact screens use smaller type so the body never sits under the Done button.
        val compact = isCompactScreen()
        Text(if (warning) "Workout closed" else "Workout saved", textAlign = TextAlign.Center,
            style = if (compact) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge)
        val body = when {
            warning -> "Some sets weren't saved. Check your phone."
            closed != null -> "${closed.done} of ${closed.total} sets · ${Format.minutes(closed.elapsedSeconds.toDouble())}"
            else -> null
        }
        body?.let {
            Text(it, style = if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}
