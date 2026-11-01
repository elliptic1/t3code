package com.t3tools.t3code.wear

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.IOException

class WatchSendTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient
    private val settings = TurnSettings(null, "full-access", "default")

    @Before fun setup() {
        server = MockWebServer()
        server.start()
        client = OkHttpClient()
    }

    @After fun teardown() {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
        server.shutdown()
    }

    private fun api() = T3Api(server.url("/").toString(), "watch-token", client)

    @Test fun sendWaitsForServerAcceptanceOverAuthenticatedWebSocket() = runBlocking {
        val received = CompletableDeferred<Pair<WebSocket, JSONObject>>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                received.complete(webSocket to JSONObject(text))
            }
        }))
        val sending = async { api().send("thread-1", "Hello from my watch", settings) }
        val (socket, message) = withTimeout(5_000) { received.await() }
        val request = server.takeRequest()
        assertEquals("/ws", request.requestUrl!!.encodedPath)
        assertEquals("2", request.requestUrl!!.queryParameter("orchestrationProtocol"))
        assertEquals("Bearer watch-token", request.getHeader("Authorization"))
        assertEquals("orchestration.dispatchCommand", message.getString("tag"))
        val command = message.getJSONObject("payload")
        assertEquals("message.dispatch", command.getString("type"))
        assertEquals("thread-1", command.getString("threadId"))
        assertEquals("Hello from my watch", command.getString("text"))
        assertEquals(0, command.getJSONArray("attachments").length())
        assertEquals("auto", command.getString("deliveryIntent"))
        assertEquals("start_immediately", command.getJSONObject("dispatchMode").getString("type"))
        assertFalse(sending.isCompleted)
        // RPC replies may be batched, and unrelated requests must not complete this send.
        socket.send(JSONArray().put(JSONObject()
            .put("_tag", "Exit").put("requestId", "other")
            .put("exit", JSONObject().put("_tag", "Success").put("value", JSONObject()))
        ).put(JSONObject()
            .put("_tag", "Exit").put("requestId", message.getString("id"))
            .put("exit", JSONObject().put("_tag", "Success").put("value", JSONObject().put("sequence", 1)))
        ).toString())
        withTimeout(5_000) { sending.await() }
    }

    @Test fun sendSurfacesTheServersRejection() = runBlocking {
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = JSONObject(text)
                webSocket.send(JSONObject()
                    .put("_tag", "Exit").put("requestId", message.getString("id"))
                    .put("exit", JSONObject().put("_tag", "Failure").put("cause", JSONArray().put(
                        JSONObject().put("_tag", "Fail").put("error", JSONObject().put("message", "Thread is archived"))
                    ))).toString())
            }
        }))
        val failure = runCatching { withTimeout(5_000) { api().send("thread-1", "Hello", settings) } }.exceptionOrNull()
        assertTrue(failure is IOException)
        assertEquals("Thread is archived", failure?.message)
    }

    @Test fun expiredCredentialsRequireRefreshingThePhoneConnection() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401))
        val failure = runCatching { withTimeout(5_000) { api().send("thread-1", "Hello", settings) } }.exceptionOrNull()
        assertTrue(failure is SessionExpired)
    }

    @Test fun disconnectBeforeAcceptanceDoesNotReportSuccess() = runBlocking {
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                webSocket.close(1000, "Server shutting down")
            }
        }))
        val failure = runCatching { withTimeout(5_000) { api().send("thread-1", "Hello", settings) } }.exceptionOrNull()
        assertTrue(failure is IOException)
        assertTrue(failure?.message.orEmpty().contains("before the server accepted"))
    }
}
