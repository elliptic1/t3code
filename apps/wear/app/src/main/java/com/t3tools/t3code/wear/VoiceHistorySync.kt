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
import org.json.JSONObject
import org.json.JSONArray
import org.json.JSONTokener

/** A single line of the voice transcript synced from the phone, mirroring VoiceHistoryLine. */
data class VoiceHistoryLine(
    val id: String,
    val speaker: String,
    val text: String,
)

/**
 * Observe the phone's voice history (written by syncVoiceHistoryToWatch). The phone
 * pushes the most recent transcript lines as JSON over the Wear Data Layer, so a
 * voice session started on the watch continues with the same memory.
 */
@Composable
internal fun ObserveVoiceHistory(
    context: Context,
    onHistory: (List<VoiceHistoryLine>) -> Unit,
) {
    val currentOnHistory by rememberUpdatedState(onHistory)
    val owner = LocalLifecycleOwner.current
    DisposableEffect(context, owner) {
        val client = Wearable.getDataClient(context)
        val uri = Uri.parse("wear://*/t3code/voice-history")
        var active = true
        fun apply(item: DataItem) {
            if (!active) return
            val map = DataMapItem.fromDataItem(item).dataMap
            val json = map.getString("historyJson")
            if (json.isNullOrBlank()) return
            val lines = try {
                val array = JSONTokener(json).nextValue()
                if (array is JSONArray) {
                    buildList {
                        for (i in 0 until array.length()) {
                            val line = array.getJSONObject(i)
                            add(
                                VoiceHistoryLine(
                                    id = line.optString("id"),
                                    speaker = line.optString("speaker"),
                                    text = line.optString("text"),
                                )
                            )
                        }
                    }
                } else emptyList()
            } catch (e: Exception) {
                emptyList()
            }
            if (lines.isNotEmpty()) currentOnHistory(lines)
        }
        fun read() {
            client.getDataItems(uri, DataClient.FILTER_LITERAL)
                .addOnSuccessListener { items ->
                    try {
                        for (item in items) apply(item)
                    } finally {
                        items.release()
                    }
                }
                .addOnFailureListener { }
        }
        val listener = DataClient.OnDataChangedListener { events ->
            if (active) for (event in events) {
                if (event.type == DataEvent.TYPE_CHANGED) apply(event.dataItem)
            }
        }
        client.addListener(listener, uri, DataClient.FILTER_LITERAL)
            .addOnSuccessListener { if (active) read() else client.removeListener(listener) }
            .addOnFailureListener { }
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

/** A completed utterance survives process death until the server acknowledges its stable id. */
internal class VoiceOutbox(private val load: () -> String, private val save: (String) -> Boolean) {
    constructor(context: Context) : this(
        { context.getSharedPreferences("voice-outbox", Context.MODE_PRIVATE).getString("pending", "[]") ?: "[]" },
        { value -> context.getSharedPreferences("voice-outbox", Context.MODE_PRIVATE).edit().putString("pending", value).commit() },
    )
    private fun read(): JSONArray = JSONArray(load())
    fun enqueue(environmentId: String, line: VoiceHistoryLine) = synchronized(lock) {
        val old = read()
        val next = (0 until old.length()).map { old.getJSONObject(it) }.filterNot {
            it.optString("environmentId") == environmentId && it.optString("id") == line.id
        }.takeLast(39) + JSONObject().put("environmentId", environmentId).put("id", line.id)
            .put("speaker", line.speaker).put("text", line.text.takeLast(16000))
        check(save(JSONArray(next).toString())) { "Could not save watch voice history." }
    }
    suspend fun flush(api: T3Api) = flush(api::saveVoiceLine)
    suspend fun flush(send: suspend (String, VoiceHistoryLine) -> Unit) {
        val batch = synchronized(lock) { val all = read(); (0 until all.length()).map { all.getJSONObject(it) } }
        for (item in batch) {
            send(item.getString("environmentId"), VoiceHistoryLine(item.getString("id"), item.getString("speaker"), item.getString("text")))
            synchronized(lock) {
                val all = read()
                val remaining = (0 until all.length()).map { all.getJSONObject(it) }.filterNot {
                    it.optString("environmentId") == item.getString("environmentId") && it.optString("id") == item.getString("id") && it.optString("text") == item.getString("text")
                }
                check(save(JSONArray(remaining).toString()))
            }
        }
    }
    companion object { private val lock = Any() }
}
