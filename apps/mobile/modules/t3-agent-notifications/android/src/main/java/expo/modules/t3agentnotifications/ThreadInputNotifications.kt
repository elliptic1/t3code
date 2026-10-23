package expo.modules.t3agentnotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import org.json.JSONObject

/** Notification actions reuse the phone's authenticated JS runtime, never URLs carrying credentials. */
class ThreadInputResponseService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val response = intent?.let { ThreadInputNotifications.beginResponse(this, it) } ?: return null
    HeadlessJsTaskService.acquireWakeLockNow(this)
    return HeadlessJsTaskConfig("T3ThreadInputResponse", Arguments.createMap().apply {
      putString("payload", response.toString())
    }, 60000, true)
  }
}

object ThreadInputNotifications {
  internal const val TAG = "t3-thread-input"
  private const val ID = 73003
  private const val CHANNEL = "thread-input"
  private const val STORE = "t3-thread-input"
  private const val REPLY = "replyText"
  private val busy = mutableSetOf<String>()
  private val handler = Handler(Looper.getMainLooper())
  private val timeouts = mutableMapOf<String, Runnable>()

  private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
  private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)
  private fun read(context: Context, key: String): JSONObject? = try {
    prefs(context).getString("item:$key", null)?.let { JSONObject(it) }
  } catch (_: Exception) { null }

  @Synchronized
  fun clear(context: Context) {
    manager(context).activeNotifications.filter { it.tag?.startsWith("$TAG:") == true }
      .forEach { manager(context).cancel(it.tag, it.id) }
    prefs(context).edit().clear().apply()
    timeouts.values.forEach { handler.removeCallbacks(it) }
    timeouts.clear()
    busy.clear()
  }

  @Synchronized
  fun sync(context: Context, payload: String, scheme: String) {
    val data = try { JSONObject(payload) } catch (_: Exception) { return }
    if (!data.optBoolean("catalogReady")) return
    val ready = data.optJSONArray("readyEnvironments") ?: return
    val enabled = data.optJSONArray("environmentIds") ?: return
    val readyIds = (0 until ready.length()).map { ready.getString(it) }.toSet()
    val enabledIds = (0 until enabled.length()).map { enabled.getString(it) }.toSet()
    val items = data.optJSONArray("items") ?: return
    val keys = mutableSetOf<String>()
    for (i in 0 until items.length()) {
      val item = items.getJSONObject(i)
      val key = item.getString("key")
      keys.add(key)
      item.put("scheme", scheme)
      if (prefs(context).getStringSet("answered", emptySet()).orEmpty().contains(key)) continue
      if (read(context, key)?.toString() != item.toString()) {
        prefs(context).edit().putString("item:$key", item.toString()).apply()
        if (key !in busy) show(context, item)
      } else if (manager(context).activeNotifications.none { it.tag == "$TAG:$key" } &&
        !prefs(context).getStringSet("shown", emptySet()).orEmpty().contains(key)) {
        show(context, item)
      }
    }
    for ((name, _) in prefs(context).all) {
      if (!name.startsWith("item:")) continue
      val key = name.removePrefix("item:")
      val item = read(context, key) ?: continue
      val environment = item.optString("environmentId")
      if (environment !in enabledIds || (environment in readyIds && key !in keys)) {
        manager(context).cancel("$TAG:$key", ID)
        prefs(context).edit().remove(name).apply()
      }
    }
  }

  private fun show(context: Context, item: JSONObject, message: String? = null, sending: Boolean = false) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= 26) manager(context).createNotificationChannel(
      NotificationChannel(CHANNEL, "Thread input requests", NotificationManager.IMPORTANCE_HIGH))
    val key = item.getString("key")
    manager(context).notify("$TAG:$key", ID, notification(context, item, message, sending))
    val shown = prefs(context).getStringSet("shown", emptySet()).orEmpty()
    prefs(context).edit().putStringSet("shown", (shown.toList().takeLast(127) + key).toSet()).apply()
  }

  internal fun notification(context: Context, item: JSONObject, message: String? = null, sending: Boolean = false): Notification {
    val key = item.getString("key")
    val scheme = item.optString("scheme", "t3code-dev")
    val body = message ?: item.optString("body").take(3000)
    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(if (icon != 0) icon else android.R.drawable.ic_dialog_info)
      .setContentTitle(item.optString("title").take(120)).setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setSubText("Input needed").setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setOnlyAlertOnce(true).setAutoCancel(false)
      .setTimeoutAfter(24 * 60 * 60 * 1000L)
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { intent ->
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse("$scheme://threads/${Uri.encode(item.getString("environmentId"))}/${Uri.encode(item.getString("threadId"))}")
      intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      builder.setContentIntent(PendingIntent.getActivity(context, key.hashCode(), intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    if (!sending) {
      val actions = item.optJSONArray("actions")
      if (actions != null) for (i in 0 until minOf(actions.length(), if (item.optBoolean("allowReply")) 2 else 3)) {
        val action = actions.getJSONObject(i)
        builder.addAction(0, action.getString("label").take(60), actionIntent(context, key, action.getString("id"), false))
      }
      if (item.optBoolean("allowReply")) builder.addAction(NotificationCompat.Action.Builder(
        0, "Reply", actionIntent(context, key, "reply", true))
        .addRemoteInput(RemoteInput.Builder(REPLY).setLabel("Your answer").build())
        .setAllowGeneratedReplies(false).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).build())
    }
    return builder.build()
  }

  private fun actionIntent(context: Context, key: String, action: String, reply: Boolean): PendingIntent {
    val intent = Intent(context, ThreadInputResponseService::class.java)
      .setData(Uri.parse("t3-input-response:/${Uri.encode(key)}/${Uri.encode(action)}"))
      .putExtra("key", key).putExtra("action", action)
    val mutability = if (reply && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else if (reply) 0 else PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getService(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutability)
  }

  @Synchronized
  internal fun beginResponse(context: Context, intent: Intent): JSONObject? {
    val key = intent.getStringExtra("key") ?: return null
    val item = read(context, key) ?: return null
    if (key in busy || prefs(context).getStringSet("answered", emptySet()).orEmpty().contains(key)) return null
    val action = intent.getStringExtra("action") ?: return null
    val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY)?.toString().orEmpty()
    val actions = item.optJSONArray("actions")
    val allowed = if (action == "reply") item.optBoolean("allowReply") && text.isNotBlank()
      else actions != null && (0 until actions.length()).any { actions.getJSONObject(it).optString("id") == action }
    if (!allowed) return null
    busy.add(key)
    val timeout = Runnable { complete(context.applicationContext, key, false) }
    timeouts[key] = timeout
    handler.postDelayed(timeout, 55000)
    show(context, item, "Sending your response…", true)
    return JSONObject().put("key", key).put("environmentId", item.getString("environmentId"))
      .put("threadId", item.getString("threadId")).put("requestId", item.getString("requestId"))
      .put("action", action).put("text", text)
  }

  @Synchronized
  fun complete(context: Context, key: String, success: Boolean) {
    busy.remove(key)
    timeouts.remove(key)?.let { handler.removeCallbacks(it) }
    if (success) {
      val done = prefs(context).getStringSet("answered", emptySet()).orEmpty()
      prefs(context).edit().putStringSet("answered", (done.toList().takeLast(127) + key).toSet())
        .remove("item:$key").apply()
      manager(context).cancel("$TAG:$key", ID)
    } else read(context, key)?.let { show(context, it, "Couldn't send. Check the connection and retry, or tap to open the thread.") }
  }
}
