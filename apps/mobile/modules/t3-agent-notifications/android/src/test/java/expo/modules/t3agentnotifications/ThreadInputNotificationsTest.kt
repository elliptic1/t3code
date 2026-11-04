package expo.modules.t3agentnotifications

import android.app.Application
import android.app.NotificationManager
import android.content.Intent
import android.os.Bundle
import androidx.core.app.RemoteInput
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
class ThreadInputNotificationsTest {
  private lateinit var context: Application
  private lateinit var manager: NotificationManager
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    manager = context.getSystemService(NotificationManager::class.java)
    shadowOf(manager).setNotificationsEnabled(true)
    ThreadInputNotifications.clear(context)
  }
  private fun item(key: String = "key-a", environment: String = "env-a") = JSONObject()
    .put("key", key).put("environmentId", environment).put("threadId", "thread-a")
    .put("requestId", "request-a").put("title", "My thread").put("body", "Which approach?")
    .put("allowReply", true).put("actions", JSONArray().put(JSONObject().put("id", "choice:one").put("label", "First")))
  private fun sync(items: List<JSONObject>, ready: List<String> = listOf("env-a")) {
    ThreadInputNotifications.sync(context, JSONObject().put("items", JSONArray(items))
      .put("readyEnvironments", JSONArray(ready)).put("environmentIds", JSONArray(listOf("env-a", "env-b")))
      .put("catalogReady", true).toString(), "t3code-dev")
  }
  @Test fun replyAndChoiceActionsTargetOnlyTheirOwnRequest() {
    sync(listOf(item(), item("key-b", "env-b")))
    val cards = manager.activeNotifications
    assertEquals(2, cards.size)
    val card = cards.first { it.tag!!.endsWith(":key-a") }.notification
    val reply = card.actions.last()
    assertEquals("Reply", reply.title)
    assertEquals(1, reply.remoteInputs.size)
    val intent = Intent(shadowOf(reply.actionIntent).savedIntent)
    val results = Bundle().apply { putCharSequence("replyText", "Use the second approach") }
    RemoteInput.addResultsToIntent(arrayOf(RemoteInput.Builder("replyText").build()), intent, results)
    val response = ThreadInputNotifications.beginResponse(context, intent)!!
    assertEquals("key-a", response.getString("key"))
    assertEquals("request-a", response.getString("requestId"))
    assertEquals("Use the second approach", response.getString("text"))
    assertNull(ThreadInputNotifications.beginResponse(context, intent))
    ThreadInputNotifications.complete(context, "key-a", true)
    assertEquals(1, manager.activeNotifications.size)
    sync(listOf(item(), item("key-b", "env-b")))
    assertEquals(1, manager.activeNotifications.size)
  }
  @Test fun resolvedRequestsAreRemovedOnlyAfterLiveEnvironmentConfirmation() {
    sync(listOf(item(), item("key-b", "env-b")))
    sync(emptyList(), ready = emptyList())
    assertEquals(2, manager.activeNotifications.size)
    sync(emptyList())
    assertEquals(1, manager.activeNotifications.size)
    assertTrue(manager.activeNotifications.single().tag!!.endsWith(":key-b"))
  }
  @Test fun failureKeepsRetryActionsAndExplainsThatResponseWasNotSent() {
    sync(listOf(item()))
    val action = manager.activeNotifications.single().notification.actions.first()
    val intent = Intent(shadowOf(action.actionIntent).savedIntent)
    assertNotNull(ThreadInputNotifications.beginResponse(context, intent))
    ThreadInputNotifications.complete(context, "key-a", false)
    val card = manager.activeNotifications.single().notification
    assertTrue(card.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString().contains("Couldn't send"))
    assertNotNull(ThreadInputNotifications.beginResponse(context, intent))
  }
  @Test fun reopeningAfterProcessDeathRestoresRetryInsteadOfLeavingSendingForever() {
    sync(listOf(item()))
    context.getSharedPreferences("t3-thread-input", 0).edit().putBoolean("sending:key-a", true).apply()
    sync(listOf(item()))
    val card = manager.activeNotifications.single().notification
    assertTrue(card.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString().contains("Response interrupted"))
    assertEquals(2, card.actions.size)
  }
  @Test fun unknownAndEmptyRepliesCannotStartAResponse() {
    sync(listOf(item()))
    assertNull(ThreadInputNotifications.beginResponse(context, Intent().putExtra("key", "key-a").putExtra("action", "reply")))
    assertNull(ThreadInputNotifications.beginResponse(context, Intent().putExtra("key", "key-a").putExtra("action", "acceptAlways")))
  }
}
