package com.ironpath.watch.ui.phase

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.ui.components.FixedScreen
import kotlinx.coroutines.delay

/**
 * S9: the phone froze the workout to finish it; no buttons. [phoneControl] is the legacy (v1)
 * variant: same layout, no spinner.
 */
@Composable
fun FinishingScreen(phoneControl: Boolean = false, closedOnPhone: Boolean = false) {
    var slow by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(30_000); slow = true }
    Box(Modifier.fillMaxSize()) {
        if (!phoneControl) CircularProgressIndicator(Modifier.fillMaxSize().padding(2.dp))
        FixedScreen {
            val title = when {
                closedOnPhone -> "Workout closed on phone"
                phoneControl -> "Phone has control"
                else -> "Finishing on phone"
            }
            val body = when {
                phoneControl -> "Send the workout from your phone to log here."
                slow -> "Still finishing. Check your phone."
                else -> "Sets are locked for a moment"
            }
            Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}
