package com.t3tools.t3code.wear

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable

/** Observe the phone's existing connection, including changes received after opening the watch. */
@Composable
internal fun ObservePhoneConnection(
    context: Context,
    onFound: (String, String, String) -> Unit,
    onChecked: () -> Unit,
    onRemoved: () -> Unit,
) {
    val currentFound by rememberUpdatedState(onFound)
    val currentChecked by rememberUpdatedState(onChecked)
    val currentRemoved by rememberUpdatedState(onRemoved)
    val owner = LocalLifecycleOwner.current
    DisposableEffect(context, owner) {
        val client = Wearable.getDataClient(context)
        val uri = Uri.parse("wear://*/t3code/pairing")
        var active = true
        fun apply(item: DataItem) {
            if (!active) return
            val map = DataMapItem.fromDataItem(item).dataMap
            val base = map.getString("baseUrl")
            val token = map.getString("accessToken")
            if (!base.isNullOrBlank() && !token.isNullOrBlank()) {
                currentFound(base, token, map.getString("label") ?: "From phone")
            }
        }
        fun read() {
            client.getDataItems(uri, DataClient.FILTER_LITERAL)
                .addOnSuccessListener { items ->
                    try {
                        for (item in items) apply(item)
                        if (active) currentChecked()
                    } finally {
                        items.release()
                    }
                }
                .addOnFailureListener { if (active) currentChecked() }
        }
        val listener = DataClient.OnDataChangedListener { events ->
            if (active) for (event in events) {
                when (event.type) {
                    DataEvent.TYPE_CHANGED -> apply(event.dataItem)
                    DataEvent.TYPE_DELETED -> currentRemoved()
                }
            }
        }
        client.addListener(listener, uri, DataClient.FILTER_LITERAL)
            .addOnSuccessListener { if (active) read() else client.removeListener(listener) }
            .addOnFailureListener { if (active) currentChecked() }
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && active) read()
        }
        owner.lifecycle.addObserver(lifecycleObserver)
        onDispose {
            active = false
            owner.lifecycle.removeObserver(lifecycleObserver)
            client.removeListener(listener)
        }
    }
}
