package com.t3tools.t3code.wear

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit

class SessionExpired : Exception("Session expired, pair again")

// Sent on every orchestration request: the server answers 400 (HTTP) or 426 (/ws) without it.
private const val PROTOCOL_VERSION = "2"
private const val PROTOCOL_HEADER = "x-t3-orchestration-protocol"
private const val SEND_TIMEOUT_MS = 20_000L

data class ThreadDetail(
    val title: String,
    val messages: List<ChatMessage>,
    val activities: List<Activity>,
    val status: ThreadStatus,
    val earlierCursor: String?,
)

class T3Api(private val baseUrl: String, private val token: String?) {

    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key)

    private suspend fun call(
        method: String,
        path: String,
        body: String? = null,
        contentType: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val url = URL(baseUrl + path)
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (path.startsWith("/api/orchestration")) conn.setRequestProperty(PROTOCOL_HEADER, PROTOCOL_VERSION)
            if (contentType != null) conn.setRequestProperty("Content-Type", contentType)
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            if (code == 401 && token != null) throw SessionExpired()
            val stream: InputStream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let { readAll(it) } ?: ""
            if (code !in 200..299) {
                val message = try {
                    val j = JSONObject(text)
                    j.str("error_description") ?: j.str("message") ?: j.str("error")
                } catch (e: Exception) { null }
                throw IOException(message ?: "HTTP $code")
            }
            text
        } finally {
            conn.disconnect()
        }
    }

    private fun readAll(stream: InputStream): String {
        val buf = ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        while (true) {
            val n = stream.read(chunk)
            if (n == -1) break
            buf.write(chunk, 0, n)
        }
        return buf.toString("UTF-8")
    }

    suspend fun environmentLabel(): String {
        val text = call("GET", "/.well-known/t3/environment")
        return try {
            JSONObject(text).optString("label")
        } catch (e: Exception) {
            baseUrl
        }
    }

    suspend fun pair(code: String): String {
        val normalized = code.filter { it.isLetterOrDigit() }.uppercase()
        val body = listOf(
            "grant_type" to "urn:ietf:params:oauth:grant-type:token-exchange",
            "subject_token" to normalized,
            "subject_token_type" to "urn:t3:params:oauth:token-type:environment-bootstrap",
            "requested_token_type" to "urn:ietf:params:oauth:token-type:access_token",
            "scope" to "orchestration:read orchestration:operate",
            "client_label" to "T3 Code Watch",
            "client_device_type" to "mobile",
            "client_os" to "Wear OS",
        ).joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }
        val text = call("POST", "/oauth/token", body, "application/x-www-form-urlencoded")
        return JSONObject(text).getString("access_token")
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    suspend fun threads(): List<ThreadRow> {
        val root = JSONObject(call("GET", "/api/orchestration/shell"))
        val projects = mutableMapOf<String, String>()
        root.optJSONArray("projects")?.let { arr ->
            for (i in 0 until arr.length()) {
                val p = arr.getJSONObject(i)
                projects[p.optString("id")] = p.optString("title")
            }
        }
        val rows = mutableListOf<ThreadRow>()
        root.optJSONArray("threads")?.let { arr ->
            for (i in 0 until arr.length()) {
                val t = arr.getJSONObject(i)
                if (!t.isNull("archivedAt") || !t.isNull("deletedAt")) continue
                rows.add(
                    ThreadRow(
                        id = t.optString("id"),
                        title = t.optString("title"),
                        project = projects[t.optString("projectId")] ?: "",
                        // `status` is the latest run's status; an active run id wins while it is still starting.
                        status = threadStatus(
                            if (t.isNull("activeRunId")) t.str("status") else "running",
                            needsInput = !t.isNull("pendingRuntimeRequest"),
                        ),
                        lastActivityAt = t.str("updatedAt") ?: "",
                    )
                )
            }
        }
        return sortRows(rows)
    }

    // Conversation items worth showing on a watch; reasoning, checkpoints and the like are skipped.
    private val toolItemTypes = setOf("command_execution", "dynamic_tool", "file_change", "web_search", "file_search")

    private fun parseItems(entries: JSONArray?, messages: MutableList<ChatMessage>, activities: MutableList<Activity>) {
        if (entries == null) return
        for (i in 0 until entries.length()) {
            val entry = entries.getJSONObject(i)
            val item = entry.optJSONObject("item") ?: entry
            val id = item.optString("id")
            val at = item.str("startedAt") ?: item.str("createdAt") ?: ""
            when (val type = item.optString("type")) {
                "user_message", "assistant_message" ->
                    messages.add(ChatMessage(id, type == "user_message", item.optString("text"), at))
                in toolItemTypes -> {
                    val summary = item.str("title") ?: item.str("input") ?: type
                    activities.add(Activity(id, summary, at))
                }
            }
        }
    }

    suspend fun thread(id: String, beforeCursor: String? = null): ThreadDetail {
        val encId = enc(id)
        val path = if (beforeCursor == null) {
            "/api/orchestration/threads/$encId/bounded?compactTurnItems=1"
        } else {
            "/api/orchestration/threads/$encId/history?cursor=${enc(beforeCursor)}"
        }
        val root = JSONObject(call("GET", path))
        val projection = root.optJSONObject("projection")

        val messages = mutableListOf<ChatMessage>()
        val activities = mutableListOf<Activity>()
        // The first page is a snapshot, earlier pages are plain item lists.
        parseItems(projection?.optJSONArray("visibleTurnItems") ?: root.optJSONArray("items"), messages, activities)

        var status = ThreadStatus.Idle
        if (projection != null) {
            val runs = projection.optJSONArray("runs")
            val latestRun = if (runs != null && runs.length() > 0) runs.getJSONObject(runs.length() - 1) else null
            val requests = projection.optJSONArray("runtimeRequests")
            var pending = false
            if (requests != null) {
                for (i in 0 until requests.length()) {
                    if (requests.getJSONObject(i).str("status") == "pending") pending = true
                }
            }
            status = threadStatus(latestRun?.str("status"), pending)
        }

        val more = root.optBoolean("hasMoreHistory")
        val cursor = if (projection != null) root.str("historyCursor") else root.str("nextCursor")
        return ThreadDetail(
            title = projection?.optJSONObject("thread")?.optString("title") ?: "",
            messages = messages,
            activities = activities,
            status = status,
            earlierCursor = if (more) cursor else null,
        )
    }

    /**
     * Commands are WebSocket-only in protocol 2: trade the bearer token for a one-shot ticket, open
     * /ws, send one `orchestration.dispatchCommand` request and wait for its Exit frame.
     * [busy] queues the message behind the thread's active run instead of starting a run.
     */
    suspend fun send(threadId: String, text: String, busy: Boolean) {
        val ticket = JSONObject(call("POST", "/api/auth/websocket-ticket", "", "application/json"))
            .getString("ticket")
        val wsUrl = baseUrl.trimEnd('/').replaceFirst("http", "ws") +
            "/ws?orchestrationProtocol=$PROTOCOL_VERSION&wsTicket=${enc(ticket)}"
        val command = JSONObject()
            .put("type", "message.dispatch")
            .put("commandId", "command:wear:${UUID.randomUUID()}")
            .put("createdBy", "user")
            .put("creationSource", "mobile")
            .put("threadId", threadId)
            .put("messageId", UUID.randomUUID().toString())
            .put("text", text)
            .put("attachments", JSONArray())
            .put("dispatchMode", JSONObject().put("type", if (busy) "queue_after_active" else "start_immediately"))
        val request = JSONObject()
            .put("_tag", "Request")
            .put("id", "1")
            .put("tag", "orchestration.dispatchCommand")
            .put("payload", command)
            .put("headers", JSONArray())

        // Empty means the server accepted the command, otherwise the reason it did not.
        val outcome = CompletableDeferred<String>()
        val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).build()
        val socket = client.newWebSocket(Request.Builder().url(wsUrl).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(request.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val frames = if (text.startsWith("[")) JSONArray(text) else JSONArray().put(JSONObject(text))
                for (i in 0 until frames.length()) {
                    val frame = frames.getJSONObject(i)
                    if (frame.optString("_tag") != "Exit" || frame.optString("requestId") != "1") continue
                    val exit = frame.getJSONObject("exit")
                    outcome.complete(if (exit.optString("_tag") == "Success") "" else failureMessage(exit))
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                outcome.complete(
                    if (response?.code == 426) "Update the T3 server and app" else t.message ?: "Connection failed"
                )
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                outcome.complete("Connection closed")
            }
        })
        try {
            val error = withTimeoutOrNull(SEND_TIMEOUT_MS) { outcome.await() } ?: "Timed out"
            if (error.isNotEmpty()) throw IOException(error)
        } finally {
            socket.close(1000, null)
            client.dispatcher.executorService.shutdown()
        }
    }

    private fun failureMessage(exit: JSONObject): String {
        val cause = exit.optJSONArray("cause")?.optJSONObject(0)
        val error = cause?.optJSONObject("error")
        return error?.str("message") ?: error?.str("detail") ?: "The server rejected the message"
    }
}
