package expo.modules.t3agentnotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** A separate, silent card: agent completion/approval alerts keep their existing behavior. */
object RunningUsageNotifications {
  const val ID = 73002
  private const val CHANNEL = "running-usage"
  private const val STORE = "t3-running-usage"
  private const val MAX_AGE_MS = 180000L

  fun stored(context: Context): JSONObject? = try {
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString("payload", null)
      ?.let { JSONObject(it) }
  } catch (_: Exception) { null }

  fun scheme(context: Context): String =
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString("scheme", "t3code-dev") ?: "t3code-dev"

  @Synchronized
  fun update(context: Context, payload: String?, scheme: String): Boolean {
    if (payload == null) { stop(context); return true }
    val data = try { JSONObject(payload) } catch (_: Exception) { return false }
    if (data.optInt("activeCount") <= 0) { stop(context); return true }
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Running thread usage", NotificationManager.IMPORTANCE_LOW))
      if (manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) { stop(context); return false }
    }
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) { stop(context); return false }
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit()
      .putString("payload", data.toString()).putString("scheme", scheme).apply()
    manager.notify(ID, notification(context, data, scheme))
    if (RunningUsageService.isRunning()) return true
    return try {
      ContextCompat.startForegroundService(context, Intent(context, RunningUsageService::class.java))
      true
    } catch (_: IllegalStateException) {
      // Android may forbid a background start. The bounded card still appears,
      // and the mounted client retries when it returns to the foreground.
      false
    } catch (_: SecurityException) { false }
  }

  fun wake(context: Context, scheme: String) {
    if (RunningUsageService.isRunning()) return
    update(context, JSONObject().put("activeCount", 1)
      .put("title", "Threads running").put("body", "Connecting to check usage…")
      .put("updatedAt", System.currentTimeMillis()).toString(), scheme)
  }

  @Synchronized
  fun stop(context: Context) {
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().clear().apply()
    RunningUsageService.markStopping()
    context.stopService(Intent(context, RunningUsageService::class.java))
    context.getSystemService(NotificationManager::class.java).cancel(ID)
  }

  internal fun notification(context: Context, data: JSONObject, scheme: String, now: Long = System.currentTimeMillis()): Notification {
    val age = now - data.optLong("updatedAt")
    val stale = age > MAX_AGE_MS || age < -60000L
    val title = if (stale) "Monitoring running threads" else data.optString("title").take(120)
    val body = if (stale) "Usage unavailable · reconnecting. Estimates paused."
      else data.optString("body").take(640)
    val style = NotificationCompat.InboxStyle().setBigContentTitle(title)
    val lines = data.optJSONArray("lines")
    if (stale || lines == null || lines.length() == 0) style.addLine(body)
    else for (index in 0 until minOf(lines.length(), 20)) style.addLine(lines.optString(index).take(640))
    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(if (icon != 0) icon else android.R.drawable.ic_dialog_info)
      .setContentTitle(title).setContentText(body).setStyle(style)
      .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setShowWhen(false)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS).setPriority(NotificationCompat.PRIORITY_LOW)
      .setTimeoutAfter(MAX_AGE_MS)
    val remaining = data.optInt("progressPercent", -1)
    if (!stale && remaining in 0..100) builder.setProgress(100, remaining, false)
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { intent ->
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse("$scheme://settings/usage?tab=limits")
      intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      builder.setContentIntent(PendingIntent.getActivity(context, ID, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    return builder.build()
  }
}
