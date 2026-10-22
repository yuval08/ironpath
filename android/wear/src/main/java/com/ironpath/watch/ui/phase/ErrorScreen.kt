package com.ironpath.watch.ui.phase

import androidx.compose.runtime.Composable
import androidx.compose.ui.text.style.TextAlign
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.ui.components.FixedScreen

/** Snapshot read failed. Diagnostics already recorded the failure. */
@Composable
fun ErrorScreen(busy: Boolean, onRetry: () -> Unit) {
    FixedScreen(edgeButton = {
        EdgeButton(onClick = onRetry, buttonSize = EdgeButtonSize.Small, enabled = !busy) { Text("Retry") }
    }) {
        Text("Can't read workout", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text("Your saved sets are kept.", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}
