package com.t3tools.t3code.wear

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class VoiceOutboxTest {
    @Test fun failedConnectionSurvivesRestartUntilAcknowledged() = runBlocking {
        var disk = "[]"
        val first = VoiceOutbox({ disk }, { disk = it; true })
        val line = VoiceHistoryLine("watch:1", "You", "Our release is Bluebird")
        first.enqueue("mac", line)
        try { first.flush { _, _ -> throw IOException("offline") }; fail("Expected offline failure") }
        catch (_: IOException) { }
        val restarted = VoiceOutbox({ disk }, { disk = it; true })
        val received = mutableListOf<Pair<String, VoiceHistoryLine>>()
        restarted.flush { environment, value -> received.add(environment to value) }
        assertEquals(listOf("mac" to line), received)
        assertEquals(0, JSONArray(disk).length())
    }
    @Test fun revisionsAndEnvironmentIdentityRemainIntact() = runBlocking {
        var disk = "[]"
        val outbox = VoiceOutbox({ disk }, { disk = it; true })
        outbox.enqueue("one", VoiceHistoryLine("item", "You", "first"))
        outbox.enqueue("two", VoiceHistoryLine("item", "You", "other server"))
        outbox.flush { environment, _ ->
            if (environment == "one") outbox.enqueue("one", VoiceHistoryLine("item", "You", "revised"))
        }
        val remaining = JSONArray(disk)
        assertEquals(1, remaining.length())
        assertEquals("one", remaining.getJSONObject(0).getString("environmentId"))
        assertEquals("revised", remaining.getJSONObject(0).getString("text"))
    }
    @Test fun unreadableHistoryIsNotOverwritten() {
        var disk = "broken"
        val outbox = VoiceOutbox({ disk }, { disk = it; true })
        try { outbox.enqueue("mac", VoiceHistoryLine("new", "You", "hello")); fail("Expected decode failure") }
        catch (_: org.json.JSONException) { }
        assertEquals("broken", disk)
    }
}
