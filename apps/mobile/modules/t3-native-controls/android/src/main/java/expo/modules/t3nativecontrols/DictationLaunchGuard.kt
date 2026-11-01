package expo.modules.t3nativecontrols

import android.os.Handler
import android.os.Looper

/** Recover only launches that never took focus; a visible recognizer may run indefinitely. */
internal class DictationLaunchGuard {
  private val handler = Handler(Looper.getMainLooper())
  private var check: Runnable? = null

  fun start(ownerHasFocus: () -> Boolean, onFailedLaunch: () -> Unit) {
    clear()
    val task = Runnable {
      check = null
      if (ownerHasFocus()) onFailedLaunch()
    }
    check = task
    handler.postDelayed(task, 10_000L)
  }

  fun clear() {
    check?.let(handler::removeCallbacks)
    check = null
  }
}
