package com.t3tools.t3code.wear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

class SessionExpired : Exception("Connection expired")

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

/** Mirrors the server's VoiceSessionConnection: everything a client needs to stream audio. */
data class VoiceConnection(
    val instructions: String,
    val protocol: String,
    val transport: String,
    val endpoint: String,
    val transcriptionModel: String,
    val model: String,
    val voice: String,
    val clientSecret: String,
)

class T3Api(
    private val baseUrl: String,
    private val token: String?,
    private val rpcClient: OkHttpClient = watchRpcClient,
) {

    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key)

    constructor(context: android.content.Context) : this(
        context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE).getString("baseUrl", null)
            ?: throw java.io.IOException("Open T3 Code on your phone to sync the connection"),
        context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE).getString("token", null),
    )

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
            if (path.startsWith("/api/orchestration/")) {
                conn.setRequestProperty("x-t3-orchestration-protocol", "2")
            }
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

    // Decode and sort on a worker too; callers resume on the UI thread after call().
    suspend fun threads(): List<ThreadRow> = withContext(Dispatchers.IO) {
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
                val status = shellThreadStatus(t)
                rows.add(
                    ThreadRow(
                        id = t.optString("id"),
                        title = t.optString("title"),
                        project = projects[t.optString("projectId")] ?: "",
                        status = status,
                        lastActivityAt = t.str("updatedAt") ?: "",
                        // Servers that predate settling omit the field.
                        settled = t.str("settledOverride") == "settled",
                    )
                )
            }
        }
        sortRows(rows)
    }

    suspend fun thread(id: String, beforeCursor: String? = null): ThreadDetail = withContext(Dispatchers.IO) {
        val encId = enc(id)
        val snapshot = JSONObject(call("GET", "/api/orchestration/threads/$encId/bounded"))
        val history = beforeCursor?.let {
            JSONObject(call("GET", "/api/orchestration/threads/$encId/history?cursor=${enc(it)}&view=conversation"))
        }
        parseThreadSnapshot(snapshot, history)
    }

    suspend fun send(threadId: String, text: String, settings: TurnSettings) {
        val commandId = UUID.randomUUID().toString()
        val messageId = UUID.randomUUID().toString()
        val payload = JSONObject()
            .put("type", "message.dispatch")
            .put("commandId", commandId)
            .put("createdBy", "user")
            .put("creationSource", "mobile")
            .put("threadId", threadId)
            .put("messageId", messageId)
            .put("text", text)
            .put("attachments", JSONArray())
            .put("deliveryIntent", "auto")
            .put("dispatchMode", JSONObject().put("type", "start_immediately"))
        if (settings.modelSelection != null) payload.put("modelSelection", settings.modelSelection)
        dispatchWatchCommand(rpcClient, baseUrl, token, payload)
    }

    /** Ask the server for a live voice-session connection, then stream audio against it. */
    suspend fun createVoiceSession(): VoiceConnection = withContext(Dispatchers.IO) {
        val j = JSONObject(call("POST", "/api/orchestration/voice-session"))
        VoiceConnection(
            instructions = j.optString("instructions"),
            protocol = j.optString("protocol"),
            transport = j.optString("transport"),
            endpoint = j.optString("endpoint"),
            transcriptionModel = j.optString("transcriptionModel"),
            model = j.optString("model"),
            voice = j.optString("voice"),
            clientSecret = j.optString("clientSecret"),
        )
    }
}
