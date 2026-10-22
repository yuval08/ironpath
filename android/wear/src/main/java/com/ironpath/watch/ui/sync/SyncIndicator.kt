package com.ironpath.watch.ui.sync

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.CurvedModifier
import androidx.wear.compose.foundation.curvedComposable
import androidx.wear.compose.foundation.padding
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.material3.curvedText
import androidx.wear.compose.material3.timeTextCurvedText
import androidx.wear.compose.material3.timeTextSeparator
import com.ironpath.watch.state.SyncState
import com.ironpath.watch.ui.components.isCompactScreen

/** Human title for each sync state (S7 heading and TalkBack). */
fun SyncState.title(): String = when (this) {
    SyncState.Synced -> "Synced"
    SyncState.SavedOnWatch -> "Saved on watch"
    SyncState.WaitingForPhone -> "Waiting for phone"
    SyncState.NeedsReview -> "Needs review"
    SyncState.UpdateNeeded -> "Update needed"
}

private fun SyncState.icon(): ImageVector? = when (this) {
    SyncState.WaitingForPhone -> Icons.Filled.Phone
    SyncState.NeedsReview -> Icons.Filled.Warning
    SyncState.UpdateNeeded -> Icons.Filled.Refresh
    else -> null
}

@Composable
private fun SyncState.color(): Color = when (this) {
    SyncState.Synced -> MaterialTheme.colorScheme.primary
    SyncState.SavedOnWatch, SyncState.UpdateNeeded -> MaterialTheme.colorScheme.tertiary
    SyncState.WaitingForPhone -> MaterialTheme.colorScheme.onSurfaceVariant
    SyncState.NeedsReview -> MaterialTheme.colorScheme.error
}

/** Shape *and* color differ per state, so color is never the only signal (§6). */
@Composable
fun SyncIndicator(state: SyncState, modifier: Modifier = Modifier, large: Boolean = false) {
    val color = state.color()
    val scale = if (large) 2 else 1
    when (state) {
        SyncState.Synced -> Box(modifier.size(6.dp * scale).background(color, CircleShape))
        SyncState.SavedOnWatch -> Box(modifier.size(8.dp * scale).border(1.5.dp * scale, color, CircleShape))
        else -> Icon(state.icon()!!, contentDescription = null, modifier.size(14.dp * scale), tint = color)
    }
}

/**
 * Shared TimeText: optional rest countdown, clock, then the sync indicator (with a curved label
 * for Review/Update). Transparent tap targets sit on top: rest time → back to Rest, rest → S7.
 */
@Composable
fun WatchTimeText(sync: SyncState?, restText: String?, onSync: () -> Unit, onRest: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    val error = MaterialTheme.colorScheme.error
    val tertiary = MaterialTheme.colorScheme.tertiary
    val arc = MaterialTheme.typography.arcMedium
    val compact = isCompactScreen()
    Box(Modifier.fillMaxWidth()) {
        TimeText { time ->
            if (restText != null) {
                curvedText(restText, style = arc.copy(color = primary))
                timeTextSeparator()
            }
            timeTextCurvedText(time)
            if (sync != null) {
                curvedComposable(CurvedModifier.padding(angular = 4.dp)) { SyncIndicator(sync) }
                // The curved word only fits large rounds; on 192 dp it collides with screen titles.
                if (!compact) when (sync) {
                    SyncState.NeedsReview -> curvedText("Review", style = arc.copy(color = error))
                    SyncState.UpdateNeeded -> curvedText("Update", style = arc.copy(color = tertiary))
                    else -> Unit
                }
            }
        }
        Row(Modifier.align(Alignment.TopCenter)) {
            if (restText != null) TapTarget("Rest $restText left. Double tap to show rest.", onRest)
            if (sync != null) TapTarget("Sync status: ${sync.title()}. Double tap for details.", onSync)
        }
    }
}

@Composable
private fun TapTarget(description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(width = 72.dp, height = 40.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description }
    )
}
