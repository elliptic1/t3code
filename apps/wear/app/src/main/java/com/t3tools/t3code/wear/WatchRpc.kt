package com.t3tools.t3code.wear

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException

internal val watchRpcClient = OkHttpClient()

/** Dispatch through the same authenticated RPC as the other clients, awaiting server acceptance. */
internal suspend fun dispatchWatchCommand(
    client: OkHttpClient,
    baseUrl: String,
    token: String?,
    command: JSONObject,
) {
    val requestId = "1"
    val result = CompletableDeferred<Unit>()
    val request = Request.Builder()
        .url(baseUrl.toHttpUrl().newBuilder()
            .addPathSegment("ws")
            .addQueryParameter("orchestrationProtocol", "2")
            .addQueryParameter("clientSurface", "mobile")
            .build())
        .apply { if (token != null) header("Authorization", "Bearer $token") }
        .build()
    val socket = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            val message = JSONObject()
                .put("_tag", "Request")
                .put("id", requestId)
                .put("tag", "orchestration.dispatchCommand")
                .put("payload", command)
                .put("headers", JSONArray())
            if (!webSocket.send(message.toString())) {
                result.completeExceptionally(IOException("Connection closed before sending"))
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            try {
                val decoded = JSONTokener(text).nextValue()
                val messages = if (decoded is JSONArray) decoded else JSONArray().put(decoded)
                for (index in 0 until messages.length()) {
                    val message = messages.getJSONObject(index)
                    when (message.optString("_tag")) {
                        "Ping" -> webSocket.send(JSONObject().put("_tag", "Pong").toString())
                        "Exit" -> if (message.optString("requestId") == requestId) {
                            val exit = message.getJSONObject("exit")
                            if (exit.getString("_tag") == "Success") {
                                result.complete(Unit)
                            } else {
                                val causes = exit.optJSONArray("cause")
                                val error = (0 until (causes?.length() ?: 0)).firstNotNullOfOrNull {
                                    causes?.optJSONObject(it)?.optJSONObject("error")?.optString("message")
                                        ?.takeIf { value -> value.isNotBlank() }
                                }
                                result.completeExceptionally(IOException(error ?: "Server rejected the message"))
                            }
                        }
                        "Defect", "ClientProtocolError" ->
                            result.completeExceptionally(IOException("Server could not process the message"))
                    }
                }
            } catch (e: Exception) {
                result.completeExceptionally(IOException("Invalid response from server", e))
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            result.completeExceptionally(
                if (response?.code == 401) SessionExpired() else IOException("Could not send: ${t.message}", t)
            )
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, reason)
            result.completeExceptionally(IOException("Connection closed before the server accepted the message"))
        }
    })
    try {
        val accepted = withTimeoutOrNull(15_000) { result.await(); true }
        if (accepted == null) throw IOException("Server did not confirm the message. Check the thread before retrying.")
    } finally {
        socket.cancel()
    }
}
