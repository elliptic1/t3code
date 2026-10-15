package expo.modules.t3weardatalayer

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.Promise

/** Holds the existing connection runtime while voice is enabled, including after activity recreation. */
class ConnectionPresenceService : HeadlessJsTaskService() {
  override fun onCreate() {
    super.onCreate()
    synchronized(waiters) { active = true }
    startForeground(21003, watchNotification(this, "Automatic server reconnection is active"))
  }
  private var taskStarted = false
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    if (taskStarted) return null
    taskStarted = true
    return HeadlessJsTaskConfig("T3ConnectionPresence", Arguments.createMap(), 0, true)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    super.onStartCommand(intent ?: Intent(this, ConnectionPresenceService::class.java), flags, startId)
    return START_STICKY
  }
  override fun onDestroy() {
    synchronized(waiters) {
      active = false
      waiters.forEach { it.resolve(null) }
      waiters.clear()
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
  companion object {
    private var active = false
    private val waiters = mutableListOf<Promise>()
    fun awaitStop(promise: Promise) = synchronized(waiters) {
      if (active) waiters.add(promise) else promise.resolve(null)
    }
  }
}
