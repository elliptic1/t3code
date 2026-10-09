package expo.modules.t3weardatalayer

import android.content.Context
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Mirrors the phone app's T3 pairing ({baseUrl, accessToken}) to the paired Wear
 * watch via the Wear Data Layer. The watch companion app reads this data item and
 * auto-pairs from the phone's session — no watch-side pairing UI needed.
 */
class T3WearDataLayerModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: appContext.currentActivity
      ?: error("No Android context available")

  private val dataClient: DataClient
    get() = Wearable.getDataClient(context)

  override fun definition() = ModuleDefinition {
    Name("T3WearDataLayer")

    // Write (or update) the pairing on the Data Layer so the watch can read it.
    AsyncFunction("setPairing") { baseUrl: String, accessToken: String ->
      val putReq = PutDataMapRequest.create(PATH_PAIRING).apply {
        dataMap.putString(KEY_BASE_URL, baseUrl)
        dataMap.putString(KEY_ACCESS_TOKEN, accessToken)
      }
      // awaitCompletion ensures the write has synced to connected nodes before resolving.
      dataClient.putDataItem(putReq.asPutDataRequest())
        .addOnSuccessListener { }
        .addOnFailureListener { error(it) }
    }

    // Remove the pairing from the Data Layer (on unpair/sign-out).
    AsyncFunction("clearPairing") {
      dataClient.getDataItems()
        .addOnSuccessListener { items ->
          for (item in items) {
            if (item.uri.path == PATH_PAIRING) {
              dataClient.deleteDataItems(item.uri)
            }
          }
        }
    }

    // Read the currently mirrored pairing (used for diagnostics/verification).
    AsyncFunction("getPairing") { promise: expo.modules.kotlin.Promise ->
      dataClient.getDataItems(android.net.Uri.parse(URI_PAIRING))
        .addOnSuccessListener { items ->
          val item = items.firstOrNull() ?: run { promise.resolve(null); return@addOnSuccessListener }
          val dm = DataMapItem.fromDataItem(item).dataMap
          promise.resolve(
            mapOf(
              KEY_BASE_URL to dm.getString(KEY_BASE_URL),
              KEY_ACCESS_TOKEN to dm.getString(KEY_ACCESS_TOKEN),
            ),
          )
        }
        .addOnFailureListener { promise.reject("WEAR_READ_FAILED", it.message, it) }
    }
  }

  private companion object {
    const val PATH_PAIRING = "/t3code/pairing"
    const val URI_PAIRING = "wearable:///t3code/pairing"
    const val KEY_BASE_URL = "baseUrl"
    const val KEY_ACCESS_TOKEN = "accessToken"
  }
}
