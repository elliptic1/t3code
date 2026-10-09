package com.t3tools.t3code.wear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

class SessionExpired : Exception("Session expired, pair again")

data class TurnSettings(
    val modelSelection: JSONObject?,
    val runtimeMode: String,
    val interactionMode: String,
)

data class ThreadDetail(
    val title: String,
    val messages: List<ChatMessage>,
    val activities: List<Activity>,
    val status: ThreadStatus,
    val settings: TurnSettings,
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
        val text = call("GET", "/api/orchestration/shell")
        val root = JSONObject(text)
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
                if (t.has("archivedAt") && !t.isNull("archivedAt")) continue
                val session = t.optJSONObject("session")
                val latestTurn = t.optJSONObject("latestTurn")
                val status = threadStatus(
                    latestTurn?.str("state"),
                    session?.str("status"),
                    session?.str("activeTurnId"),
                    t.optBoolean("hasPendingApprovals") || t.optBoolean("hasPendingUserInput"),
                )
                rows.add(
                    ThreadRow(
                        id = t.optString("id"),
                        title = t.optString("title"),
                        project = projects[t.optString("projectId")] ?: "",
                        status = status,
                        lastActivityAt = t.str("updatedAt") ?: "",
                    )
                )
            }
        }
        return sortRows(rows)
    }

    suspend fun thread(id: String, beforeCursor: String? = null): ThreadDetail {
        val encId = enc(id)
        var path = "/api/orchestration/threads/$encId?turnLimit=20"
        if (beforeCursor != null) path += "&beforeCursor=${enc(beforeCursor)}"
        val text = call("GET", path)
        val root = JSONObject(text)
        val thread = root.getJSONObject("thread")

        val messages = mutableListOf<ChatMessage>()
        thread.optJSONArray("messages")?.let { arr ->
            for (i in 0 until arr.length()) {
                val m = arr.getJSONObject(i)
                messages.add(
                    ChatMessage(
                        id = m.optString("id"),
                        fromUser = m.optString("role") == "user",
                        text = m.optString("text"),
                        createdAt = m.str("createdAt") ?: "",
                    )
                )
            }
        }
        val activities = mutableListOf<Activity>()
        thread.optJSONArray("activities")?.let { arr ->
            for (i in 0 until arr.length()) {
                val a = arr.getJSONObject(i)
                activities.add(
                    Activity(
                        id = a.optString("id"),
                        summary = a.optString("summary"),
                        createdAt = a.str("createdAt") ?: "",
                    )
                )
            }
        }

        val session = thread.optJSONObject("session")
        val latestTurn = thread.optJSONObject("latestTurn")
        val hasPending = thread.optBoolean("hasPendingApprovals") || thread.optBoolean("hasPendingUserInput")
        val status = threadStatus(
            latestTurn?.str("state"),
            session?.str("status"),
            session?.str("activeTurnId"),
            hasPending,
        )

        val settings = TurnSettings(
            modelSelection = thread.optJSONObject("modelSelection"),
            runtimeMode = thread.str("runtimeMode") ?: "full-access",
            interactionMode = thread.str("interactionMode") ?: "default",
        )

        val page = root.optJSONObject("page")
        val earlierCursor = if (page != null && page.optBoolean("hasMore")) page.str("beforeCursor") else null

        return ThreadDetail(
            title = thread.optString("title"),
            messages = messages,
            activities = activities,
            status = status,
            settings = settings,
            earlierCursor = earlierCursor,
        )
    }

    suspend fun send(threadId: String, text: String, settings: TurnSettings) {
        val commandId = UUID.randomUUID().toString()
        val messageId = UUID.randomUUID().toString()
        val now = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString()
        val payload = JSONObject()
            .put("type", "thread.turn.start")
            .put("commandId", commandId)
            .put("threadId", threadId)
            .put(
                "message", JSONObject()
                    .put("messageId", messageId)
                    .put("role", "user")
                    .put("text", text)
                    .put("attachments", JSONObject.NULL)
            )
            .put("runtimeMode", settings.runtimeMode)
            .put("interactionMode", settings.interactionMode)
            .put("createdAt", now)
        if (settings.modelSelection != null) payload.put("modelSelection", settings.modelSelection)
        call("POST", "/api/orchestration/dispatch", payload.toString(), "application/json")
    }
}
