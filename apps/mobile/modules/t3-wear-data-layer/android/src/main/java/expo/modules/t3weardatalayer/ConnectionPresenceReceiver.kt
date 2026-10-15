package expo.modules.t3weardatalayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Restore an enabled connection after an in-place upgrade or an unlocked phone reboot. */
class ConnectionPresenceReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
    if (!context.getSharedPreferences("voice-presence", Context.MODE_PRIVATE).getBoolean("enabled", false)) return
    try { context.startForegroundService(Intent(context, ConnectionPresenceService::class.java)) }
    catch (_: Exception) { Log.w("T3VoicePresence", "Open T3 Code to restore its background connection") }
  }
}
