package expo.modules.t3weardatalayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.google.android.gms.wearable.Wearable
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream

internal fun watchNotification(context: Context, text: String): Notification {
  val manager = context.getSystemService(NotificationManager::class.java)
  manager.createNotificationChannel(NotificationChannel("t3-watch", "Paired watch", NotificationManager.IMPORTANCE_LOW))
  return Notification.Builder(context, "t3-watch")
    .setSmallIcon(android.R.drawable.ic_btn_speak_now)
    .setContentTitle("T3 Code voice")
    .setContentText(text)
    .setOngoing(true)
    .build()
}

/** The phone owns the provider connection. The watch carries only microphone/speaker events. */
class WatchVoiceRelayService : Service() {
  private var sessionId = ""
  private var nodeId = ""
  private var socket: WebSocket? = null
  @Volatile private var closing = false
  @Volatile private var lastContact = SystemClock.elapsedRealtime()
  private val handler = Handler(Looper.getMainLooper())
  private val idleCheck = object : Runnable {
    override fun run() {
      if (closing) return
      if (SystemClock.elapsedRealtime() - lastContact > 45000) { fail("Your watch disconnected. Start voice again to reconnect."); return }
      handler.postDelayed(this, 10000)
    }
  }
  private val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()

  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(21002, watchNotification(this, "Voice conversation on your watch"))
    if (intent == null) { stopSelf(); return START_NOT_STICKY }
    if (socket != null) {
      closing = true
      socket?.cancel()
      callbacks.remove(sessionId)?.invoke(IllegalStateException("Another watch voice session started."))
      socket = null
    }
    handler.removeCallbacks(idleCheck)
    lastContact = SystemClock.elapsedRealtime()
    handler.postDelayed(idleCheck, 10000)
    active = this
    closing = false
    sessionId = intent.getStringExtra("sessionId") ?: ""
    nodeId = intent.getStringExtra("nodeId") ?: ""
    val owner = sessionId
    try {
      val connection = JSONObject(intent.getStringExtra("connection") ?: "{}")
      val configuration = JSONObject(intent.getStringExtra("configuration") ?: "{}")
      val url = connection.getString("endpoint").let { raw ->
        if (connection.optString("model").isBlank()) raw else raw +
          (if (raw.contains("?")) "&" else "?") + "model=" + java.net.URLEncoder.encode(connection.getString("model"), "UTF-8")
      }
      val secret = connection.optString("clientSecret")
      val request = Request.Builder().url(url).apply {
        if (secret.isNotBlank()) header("Sec-WebSocket-Protocol", if (connection.optString("protocol") == "xai")
          "xai-client-secret.$secret" else "realtime, openai-insecure-api-key.$secret")
      }.build()
      socket = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          if (closing || sessionId != owner) { webSocket.close(1000, "ended"); return }
          webSocket.send(JSONObject().put("type", "session.update").put("session", configuration).toString())
          callbacks.remove(sessionId)?.invoke(null)
        }
        override fun onMessage(webSocket: WebSocket, text: String) { if (sessionId == owner) forward(text) }
        override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
          if (!closing && sessionId == owner) fail("The watch voice connection was interrupted. Tap Start to reconnect.")
        }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (!closing && sessionId == owner) fail("The voice connection closed. Tap Start to reconnect.")
        }
      })
    } catch (error: Exception) { fail("Could not connect the watch voice provider. Check voice settings on your phone.") }
    return START_NOT_STICKY
  }

  private fun forward(text: String) {
    if (closing) return
    try {
      val event = JSONObject(text)
      val delta = event.optString("delta")
      if (delta.length > 60000 && event.optString("type") in listOf("response.audio.delta", "response.output_audio.delta")) {
        delta.chunked(60000).forEach { forward(JSONObject(text).put("delta", it).toString()) }
        return
      }
      val envelope = JSONObject().put("sessionId", sessionId).put("event", event).toString()
      val output = ByteArrayOutputStream()
      GZIPOutputStream(output).use { it.write(envelope.toByteArray(Charsets.UTF_8)) }
      if (output.size() > 90000) { fail("Voice response exceeded the watch transport limit."); return }
      Wearable.getMessageClient(this).sendMessage(nodeId, EVENT_PATH, output.toByteArray())
        .addOnFailureListener { if (!closing) fail("Reconnect your watch to your phone and start voice again.") }
    } catch (error: Exception) { fail("Could not relay the voice response to your watch.") }
  }

  private fun fail(message: String) {
    if (closing) return
    callbacks.remove(sessionId)?.invoke(IllegalStateException(message))
    // Send one error directly; do not recursively retry a disconnected Data Layer.
    val output = ByteArrayOutputStream()
    GZIPOutputStream(output).use { it.write(JSONObject().put("sessionId", sessionId)
      .put("event", JSONObject().put("type", "error").put("error", JSONObject().put("message", message)))
      .toString().toByteArray(Charsets.UTF_8)) }
    Wearable.getMessageClient(this).sendMessage(nodeId, EVENT_PATH, output.toByteArray())
    finish()
  }

  private fun receive(node: String, payload: String) {
    if (closing || node != nodeId) return
    val envelope = try { JSONObject(payload) } catch (_: Exception) { return }
    if (envelope.optString("sessionId") != sessionId) return
    lastContact = SystemClock.elapsedRealtime()
    val event = envelope.optJSONObject("event") ?: return
    if (event.optString("type") == "t3.ping") return
    if (event.optString("type") == "t3.close") { finish(); return }
    if (socket?.send(event.toString()) != true) fail("Voice connection is unavailable. Start again to reconnect.")
  }

  private fun finish() {
    closing = true
    callbacks.remove(sessionId)?.invoke(IllegalStateException("Watch voice session ended."))
    handler.removeCallbacks(idleCheck)
    socket?.close(1000, "ended")
    socket = null
    if (active === this) active = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }
  override fun onDestroy() { finish(); client.dispatcher.executorService.shutdown(); super.onDestroy() }

  companion object {
    const val AUDIO_PATH = "/t3code/voice/audio"
    const val EVENT_PATH = "/t3code/voice/event"
    @Volatile private var active: WatchVoiceRelayService? = null
    private val callbacks = ConcurrentHashMap<String, (Throwable?) -> Unit>()
    fun receive(nodeId: String, payload: String) { active?.receive(nodeId, payload) }
    fun start(context: Context, nodeId: String, sessionId: String, connection: String, configuration: String, callback: (Throwable?) -> Unit) {
      callbacks[sessionId] = callback
      try {
        context.startForegroundService(Intent(context, WatchVoiceRelayService::class.java)
          .putExtra("nodeId", nodeId).putExtra("sessionId", sessionId)
          .putExtra("connection", connection).putExtra("configuration", configuration))
      } catch (error: Exception) { callbacks.remove(sessionId)?.invoke(error) }
    }
  }
}
