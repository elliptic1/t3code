package expo.modules.t3weardatalayer

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.bridge.Arguments
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/** The phone owns authentication; watch requests wake the same JS runtime and connection services. */
class WearCompanionListenerService : WearableListenerService() {
  override fun onMessageReceived(event: MessageEvent) {
    if (event.path == WatchVoiceRelayService.AUDIO_PATH) {
      WatchVoiceRelayService.receive(event.sourceNodeId, event.data.toString(Charsets.UTF_8))
      return
    }
    if (event.path != REQUEST_PATH) return
    val intent = Intent(this, WearCompanionTaskService::class.java)
      .putExtra("nodeId", event.sourceNodeId)
      .putExtra("request", event.data.toString(Charsets.UTF_8))
    startForegroundService(intent)
    HeadlessJsTaskService.acquireWakeLockNow(this)
  }
  companion object { const val REQUEST_PATH = "/t3code/companion/request" }
}

class WearCompanionTaskService : HeadlessJsTaskService() {
  override fun onCreate() {
    super.onCreate()
    startForeground(21001, watchNotification(this, "Connecting your watch to T3 Code"))
  }
  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val nodeId = intent?.getStringExtra("nodeId") ?: return null
    val request = intent.getStringExtra("request") ?: return null
    val data = Arguments.createMap().apply {
      putString("nodeId", nodeId)
      putString("request", request)
    }
    return HeadlessJsTaskConfig("T3WatchRequest", data, 60000, true)
  }
}

internal fun sendWatchResponse(context: android.content.Context, nodeId: String, response: String): com.google.android.gms.tasks.Task<Int> {
  val output = ByteArrayOutputStream()
  GZIPOutputStream(output).use { it.write(response.toByteArray(Charsets.UTF_8)) }
  require(output.size() <= 90000) { "Watch response exceeded the Data Layer limit." }
  return Wearable.getMessageClient(context).sendMessage(nodeId, "/t3code/companion/response", output.toByteArray())
}
