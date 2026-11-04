package com.t3tools.t3code.wear

import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.stringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key)

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

/** Current shells expose status and a pending request directly; older servers use session fields. */
internal fun shellThreadStatus(thread: JSONObject): ThreadStatus {
    if (thread.optJSONObject("pendingRuntimeRequest") != null ||
        thread.optBoolean("hasPendingApprovals") || thread.optBoolean("hasPendingUserInput")) {
        return ThreadStatus.NeedsYou
    }
    val status = thread.stringOrNull("status")
    if (status != null) {
        if (status == "failed") return ThreadStatus.Failed
        return if (status in setOf("preparing", "queued", "starting", "running", "waiting"))
            ThreadStatus.Working else ThreadStatus.Idle
    }
    val session = thread.optJSONObject("session")
    return threadStatus(
        thread.optJSONObject("latestTurn")?.stringOrNull("state"),
        session?.stringOrNull("status"),
        session?.stringOrNull("activeTurnId"),
        needsInput = false,
    )
}

internal fun parseThreadSnapshot(root: JSONObject, history: JSONObject? = null): ThreadDetail {
    val projection = root.getJSONObject("projection")
    val thread = projection.getJSONObject("thread")
    val rows = (history?.optJSONArray("items") ?: projection.optJSONArray("visibleTurnItems"))
        .objects().mapNotNull { it.optJSONObject("item") }
    val messages = rows.mapNotNull { item ->
        val type = item.optString("type")
        if (type != "user_message" && type != "assistant_message") return@mapNotNull null
        ChatMessage(
            id = item.getString("messageId"),
            fromUser = type == "user_message",
            text = item.optString("text"),
            createdAt = item.optString("createdAt"),
        )
    }.ifEmpty {
        if (history != null) emptyList() else projection.optJSONArray("messages").objects().map { message ->
            ChatMessage(
                id = message.getString("id"),
                fromUser = message.optString("role") == "user",
                text = message.optString("text"),
                createdAt = message.optString("createdAt"),
            )
        }
    }
    val activities = rows.mapNotNull { item ->
        val summary = when (item.optString("type")) {
            "command_execution" -> item.optString("input")
            "file_change" -> item.optString("fileName")
            "file_search" -> item.optString("pattern")
            "web_search" -> "Web search"
            else -> return@mapNotNull null
        }
        Activity(item.getString("id"), summary, item.optString("createdAt"))
    }
    val active = projection.optJSONArray("runs").objects().any {
        it.optString("status") in listOf("preparing", "queued", "starting", "running", "waiting")
    }
    val needsYou = projection.optJSONArray("runtimeRequests").objects().any {
        it.optString("status") == "pending"
    }
    val page = history ?: root
    return ThreadDetail(
        title = thread.getString("title"),
        messages = messages,
        activities = activities,
        status = if (needsYou) ThreadStatus.NeedsYou else if (active) ThreadStatus.Working else ThreadStatus.Idle,
        settings = TurnSettings(
            modelSelection = thread.optJSONObject("modelSelection"),
            runtimeMode = thread.getString("runtimeMode"),
            interactionMode = thread.getString("interactionMode"),
        ),
        earlierCursor = if (page.optBoolean("hasMoreHistory"))
            page.stringOrNull(if (history == null) "historyCursor" else "nextCursor") else null,
    )
}
