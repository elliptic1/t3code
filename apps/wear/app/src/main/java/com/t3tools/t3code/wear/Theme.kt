package com.t3tools.t3code.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/** Indigo-and-violet palette, with amber for "needs you" and teal for "working". */
internal object T3Palette {
    val Violet = Color(0xFFC4B5FF)
    val VioletDeep = Color(0xFF4B3AA8)
    val Ink = Color(0xFF07060F)
    val Glow = Color(0xFF2A1F5C)
    val Surface = Color(0xFF1D1B2E)
    val SurfaceHigh = Color(0xFF29263F)
    val OnSurface = Color(0xFFEAE6FA)
    val Muted = Color(0xFFA7A1C4)

    val Amber = Color(0xFFFFB84D)
    val OnAmber = Color(0xFF2B1A00)
    val Teal = Color(0xFF6FE3D8)
    val TealDeep = Color(0xFF0E3A40)
    val Rose = Color(0xFFFF8A9B)
}

internal val T3ColorScheme = ColorScheme(
    primary = T3Palette.Violet,
    onPrimary = Color(0xFF1A0E4D),
    primaryContainer = T3Palette.VioletDeep,
    onPrimaryContainer = Color.White,
    secondary = T3Palette.Teal,
    onSecondary = Color(0xFF00201E),
    secondaryContainer = T3Palette.TealDeep,
    onSecondaryContainer = T3Palette.Teal,
    tertiary = T3Palette.Amber,
    onTertiary = T3Palette.OnAmber,
    tertiaryContainer = Color(0xFF4A3000),
    onTertiaryContainer = T3Palette.Amber,
    surfaceContainer = T3Palette.Surface,
    surfaceContainerHigh = T3Palette.SurfaceHigh,
    onSurface = T3Palette.OnSurface,
    onSurfaceVariant = T3Palette.Muted,
    background = T3Palette.Ink,
    onBackground = T3Palette.OnSurface,
    error = T3Palette.Rose,
    onError = Color(0xFF3B0010),
)

@Composable
internal fun T3Theme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = T3ColorScheme) {
        // Static violet glow at the top fading to black; no animation, so no GPU cost.
        Box(
            modifier = Modifier.fillMaxSize()
                .background(Brush.verticalGradient(listOf(T3Palette.Glow, T3Palette.Ink))),
        ) { content() }
    }
}
