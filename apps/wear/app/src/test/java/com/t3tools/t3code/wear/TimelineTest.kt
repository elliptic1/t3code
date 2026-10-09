package com.t3tools.t3code.wear

import org.junit.Assert.assertEquals
import org.junit.Test

class TimelineTest {

    private fun msg(id: String, fromUser: Boolean, text: String, at: String) =
        ChatMessage(id, fromUser, text, at)

    private fun act(id: String, summary: String, at: String) =
        Activity(id, summary, at)

    @Test
    fun foldsActivitiesBetweenMessagesIntoToolSteps() {
        val messages = listOf(
            msg("m1", true, "hello", "2026-01-01T00:00:00Z"),
            msg("m2", false, "reply", "2026-01-01T00:01:00Z"),
        )
        val activities = listOf(
            act("a1", "Read src/a.ts", "2026-01-01T00:00:30Z"),
            act("a2", "Run tests", "2026-01-01T00:00:45Z"),
        )
        val items = timeline(messages, activities)
        assertEquals(3, items.size)
        assertEquals(ChatMessage::class, items[0]::class)
        val steps = items[1] as ToolSteps
        assertEquals(2, steps.count)
        assertEquals("Run tests", steps.last)
        assertEquals(ChatMessage::class, items[2]::class)
    }

    @Test
    fun skipsBlankMessages() {
        val messages = listOf(
            msg("m1", true, "", "2026-01-01T00:00:00Z"),
            msg("m2", false, "real", "2026-01-01T00:00:01Z"),
        )
        val items = timeline(messages, emptyList())
        assertEquals(1, items.size)
        assertEquals("m2", items[0].key)
    }

    @Test
    fun trailingActivitiesBecomeSteps() {
        val messages = listOf(msg("m1", false, "done", "2026-01-01T00:00:00Z"))
        val activities = listOf(act("a1", "Wrote file", "2026-01-01T00:00:30Z"))
        val items = timeline(messages, activities)
        assertEquals(2, items.size)
        assertEquals(ToolSteps::class, items[1]::class)
    }

    @Test
    fun mergeByIdNewerWins() {
        val older = listOf(
            msg("m1", true, "old", "t1"),
            msg("m2", false, "stable", "t2"),
        )
        val newer = listOf(
            msg("m1", true, "new", "t3"),
        )
        val merged = mergeById(older, newer) { it.id }
        assertEquals(2, merged.size)
        assertEquals("new", merged.first { it.id == "m1" }.text)
    }

    @Test
    fun statusPrecedenceNeedsYou() {
        assertEquals(ThreadStatus.NeedsYou, threadStatus("running", "running", "t", needsInput = true))
        assertEquals(ThreadStatus.Working, threadStatus("running", "running", "t", needsInput = false))
        assertEquals(ThreadStatus.Working, threadStatus(null, "running", "t", needsInput = false))
        assertEquals(ThreadStatus.Idle, threadStatus("completed", "idle", null, needsInput = false))
        assertEquals(ThreadStatus.Idle, threadStatus(null, "idle", null, needsInput = false))
    }

    @Test
    fun sortRowsNewestFirst() {
        val rows = listOf(
            ThreadRow("a", "A", "p", ThreadStatus.Idle, "2026-01-02T00:00:00Z"),
            ThreadRow("b", "B", "p", ThreadStatus.Idle, "2026-01-03T00:00:00Z"),
            ThreadRow("c", "C", "p", ThreadStatus.Idle, "2026-01-01T00:00:00Z"),
        )
        val sorted = sortRows(rows)
        assertEquals(listOf("b", "a", "c"), sorted.map { it.id })
    }
}
