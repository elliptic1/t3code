package com.t3tools.t3code.wear

import androidx.compose.foundation.MutatePriority
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.ScrollScope
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.requestFocusOnHierarchyActive
import androidx.wear.compose.foundation.rotary.RotaryScrollableBehavior
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import kotlinx.coroutines.flow.first

/** Prepare one screen ahead and retain half a screen for quick direction changes. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun rememberWatchListState(): LazyListState {
    val cacheWindow = remember { LazyLayoutCacheWindow(aheadFraction = 1f, behindFraction = 0.5f) }
    return rememberLazyListState(cacheWindow = cacheWindow)
}

/** Publish refreshes between gestures so cards cannot move underneath a drag or fling. */
internal suspend fun awaitWatchScrollIdle(state: ScrollableState) {
    snapshotFlow { state.isScrollInProgress }.first { !it }
}

// Fixed-size items avoid scaling every visible card and keep touch targets steady.
@Composable
internal fun WatchLazyColumn(
    state: LazyListState,
    contentPadding: PaddingValues,
    content: LazyListScope.() -> Unit,
) {
    val focusRequester = remember { FocusRequester() }
    val configuration = LocalConfiguration.current
    val layoutDirection = LocalLayoutDirection.current
    // Without edge scaling, leave room for the first and last buttons on round displays.
    val roundInset = if (configuration.isScreenRound) configuration.screenHeightDp.dp * 0.2f else 0.dp
    val padding = PaddingValues(
        start = contentPadding.calculateStartPadding(layoutDirection),
        top = maxOf(contentPadding.calculateTopPadding(), roundInset),
        end = contentPadding.calculateEndPadding(layoutDirection),
        bottom = maxOf(contentPadding.calculateBottomPadding(), roundInset),
    )
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .requestFocusOnHierarchyActive()
            .rotaryScrollable(
                behavior = rememberWatchRotaryBehavior(state),
                focusRequester = focusRequester,
            ),
        state = state,
        contentPadding = padding,
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        content = content,
    )
}

// Keep Wear's smoothing, haptics, and scroll cancellation while increasing crown travel.
@Composable
internal fun rememberWatchRotaryBehavior(state: ScrollableState): RotaryScrollableBehavior {
    val fasterState = remember(state) {
        object : ScrollableState by state {
            override suspend fun scroll(
                scrollPriority: MutatePriority,
                block: suspend ScrollScope.() -> Unit,
            ) {
                state.scroll(scrollPriority) {
                    val scope = this
                    block(object : ScrollScope {
                        override fun scrollBy(pixels: Float): Float = scope.scrollBy(pixels * 2f) / 2f
                    })
                }
            }

            override fun dispatchRawDelta(delta: Float): Float = state.dispatchRawDelta(delta * 2f) / 2f
        }
    }
    return RotaryScrollableDefaults.behavior(fasterState)
}
