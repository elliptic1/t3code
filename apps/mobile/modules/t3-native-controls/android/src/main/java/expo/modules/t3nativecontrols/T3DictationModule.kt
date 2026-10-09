package expo.modules.t3nativecontrols

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3DictationModule : Module() {
  private var pending: Promise? = null
  private var requestCode = 24000
  private var owner: Activity? = null

  private fun cancel() {
    val promise = pending ?: return
    pending = null
    owner?.finishActivity(requestCode)
    owner = null
    promise.resolve(null)
  }

  @Suppress("TooGenericExceptionCaught") // Release the pending promise if launching fails.
  override fun definition() = ModuleDefinition {
    Name("T3Dictation")

    Function("isAvailable") {
      val context = appContext.reactContext
      context != null && Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .resolveActivity(context.packageManager) != null
    }

    AsyncFunction("recognize") { locale: String, promise: Promise ->
      check(pending == null) { "Dictation is already active." }
      val activity = appContext.currentActivity ?: error("The app is not active.")
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      }
      // Distinguish a late result from a cancelled dialog from a new session.
      requestCode = if (requestCode >= 30000) 24000 else requestCode + 1
      owner = activity
      pending = promise
      try {
        activity.startActivityForResult(intent, requestCode)
      } catch (error: Exception) {
        pending = null
        owner = null
        throw error
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancel") { cancel() }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, result ->
      if (result.requestCode == requestCode) {
        val promise = pending
        pending = null
        owner = null
        when (result.resultCode) {
          Activity.RESULT_OK -> promise?.resolve(
            result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
          )
          Activity.RESULT_CANCELED -> promise?.resolve(null)
          else -> promise?.reject(
            "ERR_DICTATION_RECOGNITION",
            "Speech recognition failed (result code ${result.resultCode}).",
            null
          )
        }
      }
    }

    OnDestroy {
      owner?.runOnUiThread { cancel() }
    }
  }
}
