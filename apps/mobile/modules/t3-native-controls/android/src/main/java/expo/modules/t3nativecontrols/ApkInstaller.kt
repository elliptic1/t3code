package expo.modules.t3nativecontrols

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import expo.modules.kotlin.Promise
import java.io.File

/**
 * Installs an APK with PackageInstaller rather than ACTION_VIEW because only a session reports
 * when the install finishes, which is what lets the app be opened afterwards.
 *
 * Resolves null once finished or declined, or with a readable reason when the install failed.
 * ponytail: replacing T3 Code itself kills this process mid-install, so that case installs but
 * does not reopen. Reopening would need a MY_PACKAGE_REPLACED receiver.
 */
@Suppress("TooGenericExceptionCaught") // Abandon the session before rethrowing.
internal fun installAndOpenApk(
  context: Context,
  file: File,
  currentActivity: () -> Activity?,
  promise: Promise
) {
  val installer = context.packageManager.packageInstaller
  val sessionId = installer.createSession(
    PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
  )
  val action = "${context.packageName}.APK_INSTALL_$sessionId"
  val receiver = object : BroadcastReceiver() {
    override fun onReceive(receiverContext: Context, intent: Intent) {
      val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
      if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
        val confirmation = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
        val activity = currentActivity()
        if (confirmation != null && activity != null) {
          activity.startActivity(confirmation)
          return
        }
        installer.abandonSession(sessionId)
        context.unregisterReceiver(this)
        promise.resolve("The app must be open to install an APK.")
        return
      }
      context.unregisterReceiver(this)
      promise.resolve(
        when (status) {
          PackageInstaller.STATUS_SUCCESS ->
            openInstalledApp(context, intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME), currentActivity())
          PackageInstaller.STATUS_FAILURE_ABORTED -> null
          PackageInstaller.STATUS_FAILURE_CONFLICT ->
            "A differently signed copy of this app is installed. Uninstall it, then try again."
          else ->
            intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "The APK could not be installed."
        }
      )
    }
  }
  ContextCompat.registerReceiver(context, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
  try {
    installer.openSession(sessionId).use { session ->
      session.openWrite("base.apk", 0, file.length()).use { output ->
        file.inputStream().use { it.copyTo(output) }
        session.fsync(output)
      }
      // Mutable so the system can attach the status extras.
      val callback = PendingIntent.getBroadcast(
        context,
        sessionId,
        Intent(action).setPackage(context.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
      )
      session.commit(callback.intentSender)
    }
  } catch (error: Exception) {
    context.unregisterReceiver(receiver)
    installer.abandonSession(sessionId)
    throw error
  }
}

private fun openInstalledApp(context: Context, packageName: String?, activity: Activity?): String? {
  val launch = packageName?.let(context.packageManager::getLaunchIntentForPackage)
    ?: return "Installed, but this app has nothing to open."
  if (activity == null) return null
  activity.startActivity(launch)
  return null
}
