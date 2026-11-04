package expo.modules.t3voicesession

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.os.ResultReceiver

/** Keeps either voice transport alive only for the lifetime of a user-started conversation. */
class VoiceSessionService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    @Suppress("DEPRECATION")
    val receiver = intent?.getParcelableExtra<ResultReceiver>("ready")
    try {
      val manager = getSystemService(NotificationManager::class.java)
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Voice conversations", NotificationManager.IMPORTANCE_LOW)
        )
        Notification.Builder(this, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
      }
      val notification = builder
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle("Voice conversation active")
        .setContentText("Tap to return to T3 Code and end the conversation.")
        .setCategory(Notification.CATEGORY_CALL)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
      packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
        notification.setContentIntent(
          PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        )
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(NOTIFICATION_ID, notification.build(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(NOTIFICATION_ID, notification.build())
      }
      if (wakeLock == null) {
        wakeLock = getSystemService(PowerManager::class.java)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "T3Code:VoiceConversation")
          .apply {
            setReferenceCounted(false)
            // A conversation has no fixed duration. onDestroy releases this on every stop;
            // Android releases it automatically if the process is killed.
            acquire()
          }
      }
      receiver?.send(0, Bundle.EMPTY)
    } catch (error: Exception) {
      receiver?.send(1, Bundle().apply { putString("error", error.message) })
      stopSelf()
    }
    // Never restart the microphone without a live, explicitly started JS session.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    const val CHANNEL_ID = "t3-voice-conversation"
    const val NOTIFICATION_ID = 7303
  }
}
