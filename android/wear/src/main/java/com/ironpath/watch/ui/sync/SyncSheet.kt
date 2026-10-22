package com.ironpath.watch.ui.sync

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.state.SyncState
import com.ironpath.watch.state.WatchSnapshot
import com.ironpath.watch.ui.components.ListScreen
import com.ironpath.watch.ui.components.header
import com.ironpath.watch.ui.components.itemModifier
import com.ironpath.watch.ui.components.textItem
import java.text.DateFormat
import java.util.Date

fun SyncState.body(): String = when (this) {
    SyncState.Synced -> "All sets are on your phone."
    SyncState.SavedOnWatch -> "Your sets are safe on this watch. They sync when your phone is nearby."
    SyncState.WaitingForPhone -> "Open Ironpath on your phone to save these sets."
    SyncState.NeedsReview -> "A set was changed on both screens."
    SyncState.UpdateNeeded -> "Install matching phone and watch apps."
}

/** The only place raw sync counts appear (Details). */
fun details(snapshot: WatchSnapshot, notificationsOn: Boolean): String {
    val sync = snapshot.sync
    return listOfNotNull(
        "${sync.pendingMutations + sync.pendingRestOps} actions queued",
        "${sync.receivedMutations} received by phone",
        if (sync.reviewCount > 0) "${sync.reviewCount} to review" else null,
        snapshot.peer.protocol?.let { "protocol $it" },
        if (!notificationsOn) "Wrist alerts off" else null,
    ).joinToString(" · ")
}

/** S7: what the indicator means, plus the one action that helps. */
@Composable
fun SyncSheet(snapshot: WatchSnapshot, notificationsOn: Boolean, busy: Boolean, onRetry: () -> Unit, onReview: () -> Unit) {
    val state = snapshot.syncState
    val edge: (@Composable androidx.compose.foundation.layout.BoxScope.() -> Unit)? = when (state) {
        SyncState.SavedOnWatch, SyncState.WaitingForPhone -> ({
            EdgeButton(onClick = onRetry, buttonSize = EdgeButtonSize.Small, enabled = !busy) { Text("Retry now") }
        })
        SyncState.NeedsReview -> ({ EdgeButton(onClick = onReview, buttonSize = EdgeButtonSize.Small) { Text("Review") } })
        else -> null
    }
    ListScreen(edgeButton = edge) { spec ->
        item {
            Row(itemModifier(spec), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically) {
                SyncIndicator(state)
                Text(state.title(), style = MaterialTheme.typography.titleMedium)
            }
        }
        textItem(spec, state.body(), style = { MaterialTheme.typography.bodyMedium })
        snapshot.sync.lastSyncedWall?.let {
            textItem(spec, "Last synced ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it))}")
        }
        header(spec, "Details")
        textItem(spec, details(snapshot, notificationsOn))
    }
}
