package expo.modules.t3weardatalayer

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Returns authenticated phone-side results over the Wear Data Layer. */
class T3WearDataLayerModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: appContext.currentActivity
      ?: error("No Android context available")

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
  }
}
