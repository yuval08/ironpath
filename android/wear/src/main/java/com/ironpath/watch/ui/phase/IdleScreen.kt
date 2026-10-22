package com.ironpath.watch.ui.phase

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.R
import com.ironpath.watch.ui.components.FixedScreen
import com.ironpath.watch.ui.components.isCompactScreen

/** S1: no workout on the watch. Refresh = flush + re-inspect; Settings sits above it. */
@Composable
fun IdleScreen(busy: Boolean, onRefresh: () -> Unit, onSettings: () -> Unit) {
    FixedScreen(edgeButton = {
        EdgeButton(onClick = onRefresh, buttonSize = EdgeButtonSize.Small, enabled = !busy) { Text("Refresh") }
    }) {
        if (!isCompactScreen()) Image(painterResource(R.drawable.ic_ironpath), contentDescription = "Ironpath", Modifier.size(40.dp))
        Text("No workout on watch", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text("Start one on your phone and tap Send to watch", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        FilledTonalIconButton(onClick = onSettings, modifier = Modifier.size(IconButtonDefaults.SmallButtonSize)) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
    }
}
