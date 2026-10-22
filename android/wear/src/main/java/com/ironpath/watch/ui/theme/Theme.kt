package com.ironpath.watch.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/** Dark, OLED-first scheme from UI spec §4. Brand teal is only ever a fill behind white text. */
val IronpathColorScheme = ColorScheme(
    background = Color(0xFF000000),
    onBackground = Color(0xFFEFF5F4),
    onSurface = Color(0xFFEFF5F4),
    onSurfaceVariant = Color(0xFFB4C4C1),
    surfaceContainerLow = Color(0xFF0F1A19),
    surfaceContainer = Color(0xFF1A2624),
    surfaceContainerHigh = Color(0xFF243230),
    primary = Color(0xFF5EEAD4),
    onPrimary = Color(0xFF003732),
    primaryContainer = Color(0xFF0F766E),
    onPrimaryContainer = Color(0xFFFFFFFF),
    primaryDim = Color(0xFF2DD4BF),
    tertiary = Color(0xFFFCD34D),
    onTertiary = Color(0xFF3D2E00),
    error = Color(0xFFFF8A80),
    errorContainer = Color(0xFF5C1A16),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF4F605D),
    outlineVariant = Color(0xFF2E3B39),
)

/** Gray used for ambient outlines (≥ 6:1 on black). */
val AmbientGray = Color(0xFF8A9A97)

/**
 * Ambient state from `AmbientLifecycleObserver`. [tick] increments on each `onUpdateAmbient`
 * (about once a minute), which is the only time ambient screens redraw.
 */
@Immutable
data class AmbientState(val isAmbient: Boolean = false, val burnInProtection: Boolean = false, val tick: Int = 0)

val LocalAmbient = staticCompositionLocalOf { AmbientState() }

@Composable
fun IronpathTheme(ambient: AmbientState = AmbientState(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalAmbient provides ambient) {
        MaterialTheme(colorScheme = IronpathColorScheme, content = content)
    }
}
