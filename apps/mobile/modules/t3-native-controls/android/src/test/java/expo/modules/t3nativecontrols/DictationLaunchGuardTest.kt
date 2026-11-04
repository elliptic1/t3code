package expo.modules.t3nativecontrols

import android.os.Looper
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class DictationLaunchGuardTest {
  @Test
  fun `recovers a recognizer that never took window focus`() {
    var failures = 0
    DictationLaunchGuard().start({ true }) { failures++ }
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(9))
    assertEquals(0, failures)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
    assertEquals(1, failures)
  }

  @Test
  fun `does not interrupt a visible recognition session`() {
    var failures = 0
    DictationLaunchGuard().start({ false }) { failures++ }
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(2))
    assertEquals(0, failures)
  }

  @Test
  fun `a completed or cancelled launch cannot affect the next session`() {
    var failures = 0
    val guard = DictationLaunchGuard()
    guard.start({ true }) { failures++ }
    guard.clear()
    guard.start({ false }) { failures++ }
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(10))
    assertEquals(0, failures)
  }
}
