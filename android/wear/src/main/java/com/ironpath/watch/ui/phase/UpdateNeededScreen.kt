package com.ironpath.watch.ui.phase

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.state.Peer
import com.ironpath.watch.ui.components.FixedScreen

/** S11: shown once per version pair; Continue keeps working in compatible (v1) mode. */
@Composable
fun UpdateNeededScreen(peer: Peer, busy: Boolean, onContinue: () -> Unit) {
    FixedScreen(edgeButton = {
        EdgeButton(onClick = onContinue, buttonSize = EdgeButtonSize.Small, enabled = !busy) { Text("Continue") }
    }) {
        Icon(Icons.Filled.Refresh, contentDescription = null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.tertiary)
        Text("Update needed", style = MaterialTheme.typography.titleMedium)
        val which = when (peer.updateTarget) { "phone" -> "Update the phone app"; "watch" -> "Update the watch app"; else -> "Install matching phone and watch apps" }
        Text("$which to log from both screens.", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, maxLines = 3)
        Text(listOfNotNull(peer.watchVersion?.let { "Watch $it" }, peer.phoneVersion?.let { "Phone $it" }).joinToString(" · "),
            style = MaterialTheme.typography.bodyExtraSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
