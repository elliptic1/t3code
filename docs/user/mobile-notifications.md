# Mobile notifications

Sign in to T3 Connect, link your environments, and enable **Device Notifications** in **Settings → Notifications** to receive alerts when an agent finishes, fails, needs approval, or asks for input. Tap a notification to open its thread. Your environment must have agent activity publishing enabled.

Enable **Ongoing Agent Activity** on Android or **Live Activity Updates** on iOS to follow work without opening the app. Finished results remain visible for up to 15 minutes. You can dismiss an Android activity card without disabling alerts; turn off ongoing activity in Settings to stop future cards.

Ordinary alerts stay quiet while the mobile app is in the foreground. Ongoing activity continues to update. Viewing a thread on another device does not silence your phone's alerts.

On Android, **Running thread usage** is a separate, quiet ongoing notification while threads are active. Expand it to see each running provider's allowance remaining, recent consumption in percentage points per hour, and an estimated exhaustion time. Estimates use up to 15 minutes of observed usage, need at least a minute of samples, and pause when readings are stale or the connection drops. Quota resets restart measurement. This monitor uses your existing paired connections, including direct and Tailscale connections, and keeps them alive until work finishes; it does not require T3 Connect. Allow notifications when prompted, or control its channel in Android Settings.

Android push notifications require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing agent activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. Android 7's battery-saving modes can delay removal of expired cards.

Notification permission and Android notification channels are controlled in system Settings. Background delivery of agent alerts requires T3 Connect; a direct or Tailscale connection alone does not enable push notifications. Agent alerts do not require the mobile app to maintain a connection to your environment. Force-stopping the Android app in system Settings prevents background delivery and usage monitoring until you open it again.
