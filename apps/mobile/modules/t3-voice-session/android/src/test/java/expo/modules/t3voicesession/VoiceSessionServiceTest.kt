package expo.modules.t3voicesession

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPowerManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 30, 36], manifest = Config.NONE)
class VoiceSessionServiceTest {
  @Test
  fun conversationHoldsCpuWithAnOngoingNotificationAndReleasesBothOnEnd() {
    val controller = Robolectric.buildService(VoiceSessionService::class.java).create()
    val service = controller.get()
    val intent = Intent(service, VoiceSessionService::class.java)
    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(intent, 0, 1))
    val lock = ShadowPowerManager.getLatestWakeLock()
    assertTrue(lock.isHeld)
    val notifications = shadowOf(service.getSystemService(NotificationManager::class.java))
    val notification = notifications.getNotification(VoiceSessionService.NOTIFICATION_ID)
    assertNotNull(notification)
    assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertEquals(Notification.VISIBILITY_PUBLIC, notification.visibility)

    // A repeated start must not acquire another lock or require multiple releases.
    service.onStartCommand(intent, 0, 2)
    assertSame(lock, ShadowPowerManager.getLatestWakeLock())
    controller.destroy()
    assertFalse(lock.isHeld)
    assertNull(notifications.getNotification(VoiceSessionService.NOTIFICATION_ID))
  }
}
