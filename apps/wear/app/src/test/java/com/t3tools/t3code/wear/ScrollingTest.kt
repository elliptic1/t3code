package com.t3tools.t3code.wear

import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.runtime.snapshots.Snapshot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrollingTest {
    @Test
    fun refreshWaitsUntilTheGestureFinishes() = runBlocking {
        val state = ScrollableState { it }
        val finishGesture = CompletableDeferred<Unit>()
        val scrolling = launch(start = CoroutineStart.UNDISPATCHED) {
            state.scroll { finishGesture.await() }
        }
        val refresh = async(start = CoroutineStart.UNDISPATCHED) {
            awaitWatchScrollIdle(state)
        }
        assertFalse(refresh.isCompleted)
        finishGesture.complete(Unit)
        scrolling.join()
        Snapshot.sendApplyNotifications()
        refresh.await()
        assertTrue(refresh.isCompleted)
    }
}
