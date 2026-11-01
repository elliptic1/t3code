package com.t3tools.t3code.wear

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ThreadSnapshotTest {
    @Test
    fun readsCurrentShellStatuses() {
        for (status in listOf("preparing", "queued", "starting", "running", "waiting")) {
            assertEquals(ThreadStatus.Working, shellThreadStatus(JSONObject().put("status", status)))
        }
        for (status in listOf("idle", "completed", "interrupted")) {
            assertEquals(ThreadStatus.Idle, shellThreadStatus(JSONObject().put("status", status)))
        }
        assertEquals(ThreadStatus.Failed, shellThreadStatus(JSONObject().put("status", "failed")))
    }

    @Test
    fun pendingRequestTakesPriorityOverWorkingStatus() {
        val shell = JSONObject().put("status", "running")
            .put("pendingRuntimeRequest", JSONObject().put("kind", "approval"))
        assertEquals(ThreadStatus.NeedsYou, shellThreadStatus(shell))
        shell.put("pendingRuntimeRequest", JSONObject.NULL)
        assertEquals(ThreadStatus.Working, shellThreadStatus(shell))
    }

    @Test
    fun supportsOlderShellStatusFields() {
        val shell = JSONObject("""{"session":{"status":"running","activeTurnId":"turn"}}""")
        assertEquals(ThreadStatus.Working, shellThreadStatus(shell))
        shell.put("hasPendingUserInput", true)
        assertEquals(ThreadStatus.NeedsYou, shellThreadStatus(shell))
    }

    private fun snapshot() = JSONObject("""
        {
          "projection": {
            "thread": {"title":"Watch fix","runtimeMode":"full-access","interactionMode":"default"},
            "runs": [], "runtimeRequests": [],
            "messages": [{"id":"reply","role":"assistant","text":"Fixed it","createdAt":"2026-10-12T10:02:00Z"}],
            "visibleTurnItems": [
              {"visibility":"inherited","item":{"id":"item-question","type":"user_message","messageId":"question","text":"Please fix the watch","createdAt":"2026-10-12T10:00:00Z"}},
              {"visibility":"local","item":{"id":"item-tool","type":"command_execution","input":"Run tests","createdAt":"2026-10-12T10:01:00Z"}},
              {"visibility":"local","item":{"id":"item-reply","type":"assistant_message","messageId":"reply","text":"Fixed it","createdAt":"2026-10-12T10:02:00Z"}}
            ]
          },
          "hasMoreHistory":true,"historyCursor":"older-page"
        }
    """.trimIndent())

    @Test
    fun readsConversationIncludingInheritedContextWithoutDuplicatingLocalMessages() {
        val detail = parseThreadSnapshot(snapshot())
        assertEquals("Watch fix", detail.title)
        assertEquals(listOf("Please fix the watch", "Fixed it"), detail.messages.map { it.text })
        assertEquals(listOf(true, false), detail.messages.map { it.fromUser })
        assertEquals("Run tests", detail.activities.single().summary)
        assertEquals("older-page", detail.earlierCursor)
        assertEquals(3, timeline(detail.messages, detail.activities).size)
    }

    @Test
    fun readsOlderPageAndUsesItsCursorInsteadOfReturningRecentMessagesAgain() {
        val history = JSONObject("""
            {"items":[{"item":{"id":"old-item","type":"assistant_message","messageId":"old","text":"Earlier context","createdAt":"2026-10-11T10:00:00Z"}}],
             "hasMoreHistory":false,"nextCursor":null}
        """.trimIndent())
        val detail = parseThreadSnapshot(snapshot(), history)
        assertEquals("Earlier context", detail.messages.single().text)
        assertNull(detail.earlierCursor)
    }

    @Test
    fun fallsBackToProjectionMessagesWhenNoVisibleRowsExist() {
        val root = snapshot()
        root.getJSONObject("projection").remove("visibleTurnItems")
        assertEquals("Fixed it", parseThreadSnapshot(root).messages.single().text)
    }
}
