package com.t3tools.t3code.wear

import org.json.JSONArray
import org.json.JSONObject

data class ThreadDetail(
    val title: String,
    val messages: List<ChatMessage>,
    val activities: List<Activity>,
    val status: ThreadStatus,
    val earlierCursor: String?,
)

class T3Api(private val context: android.content.Context, private val environmentId: String? = null) {

    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key)

    suspend fun threads(): List<ThreadRow> {
        val root = requestPhone(context, JSONObject().put("operation", "shell"))
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
                        environmentId = t.optString("environmentId"),
                        title = t.optString("title"),
                        project = projects[t.optString("projectId")] ?: "",
                        // `status` is the latest run's status; an active run id wins while it is still starting.
                        status = threadStatus(
                            if (t.isNull("activeRunId")) t.str("status") else "running",
                            needsInput = !t.isNull("pendingRuntimeRequestId"),
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
        val request = JSONObject().put("operation", "thread")
            .put("environmentId", environmentId).put("threadId", id)
        beforeCursor?.let { request.put("cursor", it) }
        val root = requestPhone(context, request)
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

    suspend fun send(threadId: String, text: String, busy: Boolean) {
        requestPhone(context, JSONObject().put("operation", "send")
            .put("environmentId", environmentId).put("threadId", threadId)
            .put("text", text).put("busy", busy))
    }

}
