package com.ironpath.watch.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.CardDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text

/**
 * S2 value tile (≥ 72 × 64 dp). [edited] draws the 2 dp primary outline; [stale] (the phone changed
 * a value the user edited) draws it in error. Values over 3 characters ("62.5") drop to numeralSmall and never wrap.
 */
@Composable
fun ValueTile(
    value: String,
    unit: String,
    description: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    edited: Boolean = false,
    stale: Boolean = false,
    textValue: Boolean = false,
) {
    val colors = MaterialTheme.colorScheme
    val border = when {
        stale -> BorderStroke(2.dp, colors.error)
        edited -> BorderStroke(2.dp, colors.primary)
        else -> null
    }
    val style = when {
        textValue -> MaterialTheme.typography.titleSmall
        value.length > 3 -> MaterialTheme.typography.numeralSmall
        else -> MaterialTheme.typography.numeralMedium
    }.let { it.copy(lineHeight = it.fontSize) } // tight lines keep the tile at 64 dp
    Card(
        onClick = onClick ?: {},
        enabled = onClick != null,
        modifier = modifier.widthIn(min = 72.dp).heightIn(min = 64.dp)
            .semantics(mergeDescendants = true) { contentDescription = description },
        colors = CardDefaults.cardColors(containerColor = colors.surfaceContainer),
        border = border,
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
    ) {
        Text(value, Modifier.fillMaxWidth(), style = style, color = colors.onSurface, textAlign = TextAlign.Center,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Clip)
        Text(unit, Modifier.fillMaxWidth(), style = MaterialTheme.typography.labelSmall.let { it.copy(lineHeight = it.fontSize) },
            color = colors.onSurfaceVariant,
            textAlign = TextAlign.Center, maxLines = 1)
    }
}
