package com.ironpath.watch.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text

/** Superset slot pill ("A1"): tertiary fill, labelSmall. */
@Composable
fun SlotBadge(slot: String, modifier: Modifier = Modifier) {
    Text(
        slot,
        modifier.background(MaterialTheme.colorScheme.tertiary, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onTertiary,
    )
}

/**
 * Exercise name with an optional slot badge before it: at most 2 lines, or one marquee line on
 * compact screens so the value tiles stay above the EdgeButton.
 */
@Composable
fun ExerciseTitle(name: String, slot: String?, modifier: Modifier = Modifier, style: TextStyle = MaterialTheme.typography.titleMedium) {
    val compact = isCompactScreen()
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        if (slot != null) SlotBadge(slot)
        if (compact) Text(name, Modifier.basicMarquee(), style = style, maxLines = 1)
        else Text(name, style = style, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
