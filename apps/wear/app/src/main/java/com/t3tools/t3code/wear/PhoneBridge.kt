package com.t3tools.t3code.wear

import android.content.Context
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.zip.GZIPInputStream

/** Requests use the paired phone's connection services; no server credential lives on the watch. */
suspend fun requestPhone(context: Context, request: JSONObject): JSONObject {
    val requestId = UUID.randomUUID().toString()
    request.put("requestId", requestId)
    val client = Wearable.getMessageClient(context)
    val result = CompletableDeferred<JSONObject>()
    val listener = MessageClient.OnMessageReceivedListener { event ->
        if (event.path == "/t3code/companion/response") {
            try {
                val response = GZIPInputStream(event.data.inputStream()).bufferedReader().use { JSONObject(it.readText()) }
                if (response.optString("requestId") == requestId) result.complete(response)
            } catch (error: Exception) { result.completeExceptionally(error) }
        }
    }
    client.addListener(listener).await()
    try {
        val nodes = Wearable.getNodeClient(context).connectedNodes.await()
        val phone = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
            ?: throw IOException("Connect your watch to your phone to use T3 Code.")
        client.sendMessage(phone.id, "/t3code/companion/request", request.toString().toByteArray(Charsets.UTF_8)).await()
        val response = withTimeout(65000) { result.await() }
        if (!response.optBoolean("ok")) throw IOException(response.optString("error", "Check T3 Code on your phone."))
        return response.getJSONObject("body")
    } finally {
        client.removeListener(listener)
    }
}
