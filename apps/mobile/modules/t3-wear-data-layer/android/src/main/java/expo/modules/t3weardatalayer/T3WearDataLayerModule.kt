package expo.modules.t3weardatalayer

import android.content.Context
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

/** Connects the paired watch to the phone runtime without copying server credentials. */
class T3WearDataLayerModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: appContext.currentActivity
      ?: error("No Android context available")

  private val dataClient: DataClient
    get() = Wearable.getDataClient(context)

  override fun definition() = ModuleDefinition {
    Name("T3WearDataLayer")

    AsyncFunction("respond") { nodeId: String, response: String, promise: expo.modules.kotlin.Promise ->
      try {
        sendWatchResponse(context, nodeId, response)
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { promise.reject("WEAR_RESPONSE_FAILED", it.message, it) }
      } catch (error: Exception) {
        promise.reject("WEAR_RESPONSE_FAILED", error.message, error)
      }
    }

    AsyncFunction("setConnectionReady") { enabled: Boolean ->
      context.getSharedPreferences("voice-presence", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply()
      val intent = android.content.Intent(context, ConnectionPresenceService::class.java)
      if (enabled) context.startForegroundService(intent) else context.stopService(intent)
    }
    AsyncFunction("awaitConnectionStopped") { promise: Promise -> ConnectionPresenceService.awaitStop(promise) }

    AsyncFunction("startVoiceRelay") { nodeId: String, sessionId: String, connection: String, configuration: String, promise: Promise ->
      WatchVoiceRelayService.start(context, nodeId, sessionId, connection, configuration) { error ->
        if (error == null) promise.resolve(null)
        else promise.reject("WATCH_VOICE_FAILED", error.message, error)
      }
    }

    AsyncFunction("setCompanionAvailable") { label: String, promise: Promise ->
      val request = PutDataMapRequest.create(PATH_PAIRING).apply {
        dataMap.putString("label", label)
        dataMap.putInt("protocolVersion", 2)
      }
      dataClient.putDataItem(request.asPutDataRequest().setUrgent())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.reject("WEAR_SYNC_FAILED", "Could not notify the watch", it) }
    }

    // Legacy clients only. New companions use the phone bridge instead of server credentials.
    // Write (or update) the pairing on the Data Layer so the watch can read it.
    AsyncFunction("setPairing") { baseUrl: String, accessToken: String, label: String, promise: Promise ->
      val putReq = PutDataMapRequest.create(PATH_PAIRING).apply {
        dataMap.putString(KEY_BASE_URL, baseUrl)
        dataMap.putString(KEY_ACCESS_TOKEN, accessToken)
        dataMap.putString("label", label)
      }
      dataClient.putDataItem(putReq.asPutDataRequest().setUrgent())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.reject("WEAR_SYNC_FAILED", "Could not sync the phone connection", it) }
    }

    // Remove the pairing from the Data Layer (on unpair/sign-out).
    AsyncFunction("clearPairing") { promise: Promise ->
      dataClient.deleteDataItems(android.net.Uri.parse(URI_PAIRING), DataClient.FILTER_LITERAL)
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.reject("WEAR_SYNC_FAILED", "Could not clear the phone connection", it) }
    }

    // Read the currently mirrored pairing (used for diagnostics/verification).
    AsyncFunction("getPairing") { promise: expo.modules.kotlin.Promise ->
      dataClient.getDataItems(android.net.Uri.parse(URI_PAIRING))
        .addOnSuccessListener { items ->
          items.use {
            val item = items.firstOrNull() ?: run { promise.resolve(null); return@addOnSuccessListener }
            val dm = DataMapItem.fromDataItem(item).dataMap
            promise.resolve(
              mapOf(
                KEY_BASE_URL to dm.getString(KEY_BASE_URL),
                KEY_ACCESS_TOKEN to dm.getString(KEY_ACCESS_TOKEN),
              ),
            )
          }
        }
        .addOnFailureListener { promise.reject("WEAR_READ_FAILED", it.message, it) }
    }

    // Mirror the phone's recent voice-conversation transcript to the watch so a
    // watch-launched session continues with the same memory. historyJson is a
    // JSON array of {id, speaker, text} lines.
    AsyncFunction("setVoiceHistory") { historyJson: String, promise: Promise ->
      val putReq = PutDataMapRequest.create(PATH_VOICE_HISTORY).apply {
        dataMap.putString(KEY_HISTORY_JSON, historyJson)
      }
      dataClient.putDataItem(putReq.asPutDataRequest().setUrgent())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.reject("WEAR_SYNC_FAILED", "Could not sync voice history", it) }
    }
  }

  private companion object {
    const val PATH_PAIRING = "/t3code/pairing"
    const val URI_PAIRING = "wear://*/t3code/pairing"
    const val KEY_BASE_URL = "baseUrl"
    const val KEY_ACCESS_TOKEN = "accessToken"
    const val PATH_VOICE_HISTORY = "/t3code/voice-history"
    const val KEY_HISTORY_JSON = "historyJson"
  }
}
