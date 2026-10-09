package expo.modules.t3voicesession

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3VoiceSessionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3VoiceSession")

    AsyncFunction("start") { promise: Promise ->
      val context = requireNotNull(appContext.reactContext)
      val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
        override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
          if (resultCode == 0) promise.resolve(null)
          else promise.reject("VOICE_SERVICE_START", resultData?.getString("error"), null)
        }
      }
      // Start while the activity is visible, after RECORD_AUDIO has been granted.
      val intent = Intent(context, VoiceSessionService::class.java).putExtra("ready", receiver)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, VoiceSessionService::class.java))
      }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, VoiceSessionService::class.java))
      }
    }
  }
}
