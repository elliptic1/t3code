package expo.modules.t3agentnotifications

import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.app.NotificationManager
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.Promise

/** Keeps the existing authenticated connection runtime alive only while work is active. */
class RunningUsageService : HeadlessJsTaskService() {
  private val handler = Handler(Looper.getMainLooper())
  private val waiters = mutableListOf<Promise>()
  private var taskStarted = false
  private var stopping = false
  private val checkStaleness = object : Runnable {
    override fun run() {
      RunningUsageNotifications.stored(this@RunningUsageService)?.let {
        getSystemService(NotificationManager::class.java).notify(RunningUsageNotifications.ID,
          RunningUsageNotifications.notification(this@RunningUsageService, it, RunningUsageNotifications.scheme(this@RunningUsageService)))
      }
      handler.postDelayed(this, 60000)
    }
  }

  override fun onCreate() {
    super.onCreate()
    val data = RunningUsageNotifications.stored(this)
    if (data == null) { stopSelf(); return }
    val notification = RunningUsageNotifications.notification(this, data, RunningUsageNotifications.scheme(this))
    try {
      ServiceCompat.startForeground(this, RunningUsageNotifications.ID, notification,
        if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0)
    } catch (_: SecurityException) { stopSelf(); return }
    synchronized(lock) { current = this }
    handler.postDelayed(checkStaleness, 60000)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    if (taskStarted || RunningUsageNotifications.stored(this) == null) return null
    taskStarted = true
    return HeadlessJsTaskConfig("T3RunningUsage", Arguments.createMap(), 0, true)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (RunningUsageNotifications.stored(this) == null) { stopSelf(); return START_NOT_STICKY }
    super.onStartCommand(intent ?: Intent(this, RunningUsageService::class.java), flags, startId)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(checkStaleness)
    synchronized(lock) {
      if (current === this) current = null
      waiters.forEach { it.resolve(null) }
      waiters.clear()
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private val lock = Any()
    private var current: RunningUsageService? = null
    fun isRunning(): Boolean = synchronized(lock) { current?.let { !it.stopping } == true }
    fun markStopping() = synchronized(lock) { current?.stopping = true }
    fun awaitStop(promise: Promise) = synchronized(lock) {
      val service = current
      if (service == null) promise.resolve(null) else service.waiters.add(promise)
    }
  }
}
