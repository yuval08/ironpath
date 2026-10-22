package com.ironpath.watch.ui.components

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.ScreenScaffoldDefaults
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.TransformationSpec
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight

/** Scrollable list screen (S5, S6, S7, S12, S13): TransformingLazyColumn inside ScreenScaffold. */
@Composable
fun ListScreen(
    edgeButton: (@Composable BoxScope.() -> Unit)? = null,
    content: TransformingLazyColumnScope.(TransformationSpec) -> Unit,
) {
    val listState = rememberTransformingLazyColumnState()
    val spec = rememberTransformationSpec()
    // Default insets, but the first item starts below a TimeText that may carry a curved label.
    val defaults = ScreenScaffoldDefaults.contentPadding
    val padding = PaddingValues(start = defaults.calculateStartPadding(LayoutDirection.Ltr), top = 32.dp,
        end = defaults.calculateEndPadding(LayoutDirection.Ltr), bottom = defaults.calculateBottomPadding())
    val body: @Composable BoxScope.(PaddingValues) -> Unit = { padding ->
        TransformingLazyColumn(state = listState, contentPadding = padding) { content(spec) }
    }
    if (edgeButton != null) ScreenScaffold(scrollState = listState, edgeButton = edgeButton, contentPadding = padding, content = body)
    else ScreenScaffold(scrollState = listState, contentPadding = padding, content = body)
}

/** Modifier + transformation pair every list item applies. */
@Composable
fun TransformingLazyColumnItemScope.itemModifier(spec: TransformationSpec): Modifier =
    Modifier.fillMaxWidth().transformedHeight(this, spec)

@Composable
fun TransformingLazyColumnItemScope.transformation(spec: TransformationSpec) = SurfaceTransformation(spec)

fun TransformingLazyColumnScope.header(spec: TransformationSpec, text: String) = item {
    ListHeader(Modifier.transformedHeight(this, spec), transformation = SurfaceTransformation(spec)) { Text(text) }
}

/** Plain centered text row (explanations, footers). */
fun TransformingLazyColumnScope.textItem(
    spec: TransformationSpec,
    text: String,
    style: @Composable () -> androidx.compose.ui.text.TextStyle = { MaterialTheme.typography.bodySmall },
    color: @Composable () -> androidx.compose.ui.graphics.Color = { MaterialTheme.colorScheme.onSurfaceVariant },
) = item {
    // Plain text has no surface transformation, so it gets extra inset for the round edge.
    Text(text, itemModifier(spec).padding(horizontal = 12.dp), style = style(), color = color(), textAlign = TextAlign.Center)
}
