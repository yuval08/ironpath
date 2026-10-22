package com.ironpath.watch.ui.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.SwitchButton
import androidx.wear.compose.material3.Text
import com.ironpath.watch.state.WatchUiState
import com.ironpath.watch.ui.components.ListScreen
import com.ironpath.watch.ui.components.header
import com.ironpath.watch.ui.components.itemModifier
import com.ironpath.watch.ui.components.textItem
import com.ironpath.watch.ui.components.transformation

data class SettingsActions(
    val onAllowNotifications: () -> Unit = {},
    val onAllowPrecise: () -> Unit = {},
    val onTestAlert: () -> Unit = {},
    val onTestConnection: () -> Unit = {},
    val onDiagnostics: () -> Unit = {},
)

/** Watch-local preferences that the Settings screen toggles. */
data class SettingsPrefs(val warnBeforeEnd: Boolean, val alertInDnd: Boolean, val setWarn: (Boolean) -> Unit, val setDnd: (Boolean) -> Unit)

/** S12: alert permissions, preferences and the test tools that used to clutter the main screen. */
@Composable
fun SettingsScreen(state: WatchUiState, prefs: SettingsPrefs, versionName: String, actions: SettingsActions) {
    var warn by remember { mutableStateOf(prefs.warnBeforeEnd) }
    var dnd by remember { mutableStateOf(prefs.alertInDnd) }
    val result = state.testResult
    ListScreen { spec ->
        header(spec, "Settings")
        item {
            FilledTonalButton(onClick = { if (!state.notificationsOn) actions.onAllowNotifications() }, modifier = itemModifier(spec),
                transformation = transformation(spec), label = { Text("Wrist alerts") },
                secondaryLabel = { Text(if (state.notificationsOn) "On" else "Off · Allow") })
        }
        if (state.serviceFailed) textItem(spec, "Keep Ironpath open during rest", color = { MaterialTheme.colorScheme.tertiary })
        item {
            FilledTonalButton(onClick = { if (!state.preciseOn) actions.onAllowPrecise() }, modifier = itemModifier(spec),
                transformation = transformation(spec), label = { Text("Precise rest alerts") },
                secondaryLabel = { Text(if (state.preciseOn) "On" else "Off · Allow") })
        }
        item {
            SwitchButton(checked = warn, onCheckedChange = { warn = it; prefs.setWarn(it) }, modifier = itemModifier(spec),
                transformation = transformation(spec), label = { Text("Warn 10 s before end") })
        }
        item {
            SwitchButton(checked = dnd, onCheckedChange = { dnd = it; prefs.setDnd(it) }, modifier = itemModifier(spec),
                transformation = transformation(spec), label = { Text("Buzz in Do Not Disturb") },
                secondaryLabel = { Text("Rest end uses alarm vibration") })
        }
        item {
            FilledTonalButton(onClick = actions.onTestAlert, enabled = !state.busy, modifier = itemModifier(spec),
                transformation = transformation(spec), label = { Text("Test wrist alert") })
        }
        if (result?.first == "alert") textItem(spec, result.second, color = { MaterialTheme.colorScheme.primary })
        item {
            FilledTonalButton(onClick = actions.onTestConnection, enabled = !state.busy, modifier = itemModifier(spec),
                transformation = transformation(spec), label = { Text("Test phone connection") })
        }
        if (result?.first == "connection") textItem(spec, result.second, color = { MaterialTheme.colorScheme.primary })
        item {
            FilledTonalButton(onClick = actions.onDiagnostics, modifier = itemModifier(spec),
                transformation = transformation(spec), label = { Text("Diagnostics") })
        }
        textItem(spec, listOfNotNull("Watch $versionName", state.snapshot.peer.protocol?.let { "protocol $it" }).joinToString(" · "))
    }
}
