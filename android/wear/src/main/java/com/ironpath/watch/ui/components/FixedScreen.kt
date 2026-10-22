package com.ironpath.watch.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.ScrollState
import androidx.wear.compose.foundation.ScrollInfoProvider
import androidx.wear.compose.foundation.requestFocusOnHierarchyActive
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.ScreenScaffoldDefaults

/**
 * Centered single-screen layout with an optional EdgeButton. Content scrolls (touch and rotary)
 * only when it overflows, e.g. at the largest font scale, so every screen stays scroll-safe.
 */
@Composable
fun FixedScreen(
    edgeButton: (@Composable BoxScope.() -> Unit)? = null,
    verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
    content: @Composable ColumnScope.() -> Unit,
) {
    val scroll = rememberScrollState()
    val provider = remember(scroll) { ColumnScrollInfo(scroll) }
    val body: @Composable BoxScope.(PaddingValues) -> Unit = { padding ->
        val focus = remember { FocusRequester() }
        BoxWithConstraints {
            val inset = maxWidth * 0.1f
            Column(
                Modifier.fillMaxWidth()
                    .requestFocusOnHierarchyActive()
                    .rotaryScrollable(RotaryScrollableDefaults.behavior(scroll), focus)
                    .verticalScroll(scroll)
                    .heightIn(min = maxHeight)
                    .padding(padding)
                    .padding(horizontal = inset),
                verticalArrangement = verticalArrangement,
                horizontalAlignment = Alignment.CenterHorizontally,
                content = content,
            )
        }
    }
    if (edgeButton != null) ScreenScaffold(scrollInfoProvider = provider, edgeButton = edgeButton, contentPadding = FixedPadding,
        edgeButtonSpacing = ScreenScaffoldDefaults.EdgeButtonMinSpacing, content = body)
    else ScreenScaffold(scrollInfoProvider = provider, contentPadding = FixedPadding, content = body)
}

/** Top clears the TimeText; the scaffold adds the EdgeButton height at the bottom. */
val FixedPadding = PaddingValues(top = 24.dp, bottom = 4.dp)

/**
 * ScrollState provider that reveals the EdgeButton. The stock one reports `lastItemOffset = 0`,
 * which keeps an EdgeButton collapsed; here the button grows as the column reaches its end.
 */
class ColumnScrollInfo(private val state: ScrollState) : ScrollInfoProvider {
    override val isScrollAwayValid get() = true
    override val isScrollable get() = state.maxValue != 0
    override val isScrollInProgress get() = state.isScrollInProgress
    override val anchorItemOffset get() = state.value.toFloat()
    // maxValue is Int.MAX_VALUE until the column is measured (or when it never scrolls).
    override val lastItemOffset get() =
        if (state.maxValue == Int.MAX_VALUE) REVEAL_PX else (REVEAL_PX - (state.maxValue - state.value)).coerceAtLeast(0f)

    private companion object { const val REVEAL_PX = 1000f }
}

/** True on the 192 dp Galaxy Watch7 class of screens, where vertical space is the constraint. */
@Composable
fun isCompactScreen(): Boolean = LocalConfiguration.current.screenHeightDp < 210

/** Primary EdgeButton size: Medium (70 dp) where it fits, Small (56 dp) on compact screens. */
@Composable
fun primaryEdgeButtonSize(): EdgeButtonSize = if (isCompactScreen()) EdgeButtonSize.Small else EdgeButtonSize.Medium
