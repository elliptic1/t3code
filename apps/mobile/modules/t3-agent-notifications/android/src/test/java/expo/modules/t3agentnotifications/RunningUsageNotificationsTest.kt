package expo.modules.t3agentnotifications

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], manifest = Config.NONE)
class RunningUsageNotificationsTest {
  private lateinit var context: Application
  private lateinit var manager: NotificationManager
  private val now = 1792692000000L

  @Before
  fun setup() {
    context = RuntimeEnvironment.getApplication()
    manager = context.getSystemService(NotificationManager::class.java)
    shadowOf(manager).setNotificationsEnabled(true)
    RunningUsageNotifications.stop(context)
  }

  private fun payload(remaining: Int = 35, at: Long = now) = JSONObject()
    .put("activeCount", 2).put("title", "2 threads running · $remaining% left")
    .put("body", "Codex · Session: $remaining% left · 6.0%/h · Empty ~8:30 PM")
    .put("lines", JSONArray(listOf("Codex · Session: $remaining% left · 6.0%/h · Empty ~8:30 PM", "Claude · Weekly: 80% left")))
    .put("progressPercent", remaining).put("updatedAt", at)

  @Test
  fun ongoingCardShowsAllowanceRateAndEstimateWithoutMakingAnAlert() {
    val card = RunningUsageNotifications.notification(context, payload(), "t3code-dev", now)
    assertTrue(card.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertTrue(card.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
    assertEquals(Notification.VISIBILITY_PRIVATE, card.visibility)
    assertEquals(35, card.extras.getInt(Notification.EXTRA_PROGRESS))
    assertEquals(100, card.extras.getInt(Notification.EXTRA_PROGRESS_MAX))
    assertTrue(card.extras.getString(Notification.EXTRA_TEXT)!!.contains("6.0%/h"))
    assertEquals(2, card.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)!!.size)
  }

  @Test
  fun staleBridgeCannotKeepAdvertisingAnOldForecastOrProgressBar() {
    val card = RunningUsageNotifications.notification(context, payload(), "t3code-dev", now + 180001)
    assertTrue(card.extras.getString(Notification.EXTRA_TEXT)!!.contains("Estimates paused"))
    assertFalse(card.extras.getString(Notification.EXTRA_TEXT)!!.contains("8:30"))
    assertEquals(0, card.extras.getInt(Notification.EXTRA_PROGRESS_MAX))
  }

  @Test
  fun exhaustedQuotaStillDisplaysZeroProgress() {
    val card = RunningUsageNotifications.notification(context, payload(0), "t3code-dev", now)
    assertEquals(0, card.extras.getInt(Notification.EXTRA_PROGRESS))
    assertEquals(100, card.extras.getInt(Notification.EXTRA_PROGRESS_MAX))
    assertTrue(card.extras.getString(Notification.EXTRA_TITLE)!!.contains("0% left"))
  }

  @Test
  fun updatesReplaceOneCardAndStoppingLeavesOtherNotificationsAlone() {
    RunningUsageNotifications.update(context, payload(at = System.currentTimeMillis()).toString(), "t3code-dev")
    RunningUsageNotifications.update(context, payload(20, System.currentTimeMillis()).toString(), "t3code-dev")
    assertEquals(1, manager.activeNotifications.count { it.id == RunningUsageNotifications.ID })
    assertTrue(manager.activeNotifications.single().notification.extras.getString(Notification.EXTRA_TITLE)!!.contains("20% left"))
    manager.notify("agent-alert", 17, manager.activeNotifications.single().notification)
    RunningUsageNotifications.update(context, null, "t3code-dev")
    assertEquals("agent-alert", manager.activeNotifications.single().tag)
    assertNull(RunningUsageNotifications.stored(context))
  }

  @Test
  fun deniedPermissionDoesNotStartMonitoringOrPostACard() {
    shadowOf(manager).setNotificationsEnabled(false)
    assertFalse(RunningUsageNotifications.update(context, payload().toString(), "t3code-dev"))
    assertTrue(manager.activeNotifications.isEmpty())
    assertNull(RunningUsageNotifications.stored(context))
  }

  @Test
  fun pushWakeRequiresTheRegisteredIdentityFreshnessAndActiveWork() {
    AgentNotifications.configure(context, "device", "user", "t3code-dev", true)
    val data = mapOf("device_id" to "device", "user_id" to "user", "active" to "true", "updated_at" to System.currentTimeMillis().toString())
    assertEquals("t3code-dev", AgentNotifications.runningUsageWakeScheme(context, data))
    assertNull(AgentNotifications.runningUsageWakeScheme(context, data + ("user_id" to "other")))
    assertNull(AgentNotifications.runningUsageWakeScheme(context, data + ("active" to "false")))
    assertNull(AgentNotifications.runningUsageWakeScheme(context, data + ("updated_at" to "0")))
  }
}
