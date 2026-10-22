package com.ironpath.watch.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.ironpath.watch.R

/** "↶ Undo set 2" pill shown for 6 s after Done set. The thin ring drains as [remaining] goes 1 → 0. */
@Composable
fun UndoPill(label: String, remaining: Float, onClick: () -> Unit, enabled: Boolean = true) {
    val ring = MaterialTheme.colorScheme.primary
    CompactButton(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.filledTonalButtonColors(),
        modifier = Modifier.drawWithContent {
            drawContent()
            // Ring: a 2 dp outline that drains along the pill's edge as time runs out.
            val stroke = 2.dp.toPx()
            val inset = stroke / 2
            val outline = Path().apply {
                addRoundRect(RoundRect(inset, inset, size.width - inset, size.height - inset, CornerRadius(size.height / 2)))
            }
            val measure = PathMeasure().apply { setPath(outline, false) }
            val drained = Path()
            measure.getSegment(0f, measure.length * remaining.coerceIn(0f, 1f), drained, true)
            drawPath(outline, ring.copy(alpha = 0.25f), style = Stroke(stroke))
            drawPath(drained, ring, style = Stroke(stroke, cap = StrokeCap.Round))
        },
        icon = { Icon(painterResource(R.drawable.ic_undo), contentDescription = null, Modifier.size(ButtonDefaults.ExtraSmallIconSize)) },
        label = { Text(label) },
    )
}
