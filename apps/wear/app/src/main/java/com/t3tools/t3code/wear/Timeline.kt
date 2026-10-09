package com.t3tools.t3code.wear

enum class ThreadStatus { NeedsYou, Working, Idle }

fun threadStatus(
    turnState: String?,
    sessionStatus: String?,
    activeTurnId: String?,
    needsInput: Boolean,
): ThreadStatus {
    if (needsInput) return ThreadStatus.NeedsYou
    val working = turnState == "running" ||
        (sessionStatus == "running" && activeTurnId != null)
    return if (working) ThreadStatus.Working else ThreadStatus.Idle
}

data class ThreadRow(
    val id: String,
    val title: String,
    val project: String,
    val status: ThreadStatus,
    val lastActivityAt: String,
)

fun sortRows(rows: List<ThreadRow>): List<ThreadRow> =
    rows.sortedByDescending { it.lastActivityAt }

data class Activity(val id: String, val summary: String, val createdAt: String)

sealed interface ChatItem {
    val key: String
}

data class ChatMessage(
    val id: String,
    val fromUser: Boolean,
    val text: String,
    val createdAt: String,
) : ChatItem {
    override val key get() = id
}

data class ToolSteps(
    override val key: String,
    val count: Int,
    val last: String,
) : ChatItem

fun timeline(messages: List<ChatMessage>, activities: List<Activity>): List<ChatItem> {
    val msgs = messages.filter { it.text.isNotBlank() }.sortedBy { it.createdAt }
    val acts = activities.sortedBy { it.createdAt }

    val result = mutableListOf<ChatItem>()
    val stepBuffer = mutableListOf<Activity>()

    fun flush() {
        if (stepBuffer.isEmpty()) return
        val last = stepBuffer.last()
        result.add(ToolSteps("tools:${stepBuffer.first().id}", stepBuffer.size, last.summary))
        stepBuffer.clear()
    }

    var mi = 0
    var ai = 0
    while (mi < msgs.size) {
        val msg = msgs[mi]
        while (ai < acts.size && acts[ai].createdAt <= msg.createdAt) {
            stepBuffer.add(acts[ai])
            ai++
        }
        flush()
        result.add(msg)
        mi++
    }
    while (ai < acts.size) {
        stepBuffer.add(acts[ai])
        ai++
    }
    flush()

    return result
}

fun <T> mergeById(older: List<T>, newer: List<T>, id: (T) -> String): List<T> {
    val map = LinkedHashMap<String, T>()
    for (item in older) map[id(item)] = item
    for (item in newer) map[id(item)] = item
    return map.values.toList()
}
